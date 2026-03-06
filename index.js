require('dotenv').config();
const chokidar = require('chokidar');
const nodemailer = require('nodemailer');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs-extra');

const WATCH_DIR = process.env.WATCH_DIR || path.join(process.env.USERPROFILE, 'Downloads', '_kindle');
const PROCESSED_DIR = path.join(WATCH_DIR, 'processed');
const LOG_FILE = path.join(WATCH_DIR, 'activity.log');
const KINDLE_EMAIL = process.env.KINDLE_EMAIL;

// Ensure directories exist
fs.ensureDirSync(WATCH_DIR);
fs.ensureDirSync(PROCESSED_DIR);

/**
 * Custom logger to file and console
 */
function logToFile(msg) {
    const timestamp = new Date().toLocaleString();
    const logEntry = `[${timestamp}] ${msg}\n`;
    console.log(msg);
    fs.appendFileSync(LOG_FILE, logEntry);
}

logToFile(`--- Monitor Started ---`);
logToFile(`Monitoring directory: ${WATCH_DIR}`);
logToFile(`Sending to: ${KINDLE_EMAIL}`);

// Setup Email Transporter
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

/**
 * Sends the EPUB file to Kindle email
 */
async function sendToKindle(filePath) {
    const fileName = path.basename(filePath);
    logToFile(`[EMAIL] Attempting to send ${fileName}...`);

    const mailOptions = {
        from: process.env.SMTP_USER,
        to: KINDLE_EMAIL,
        subject: 'Convert',
        text: 'Sent from MD-to-Kindle Automator.',
        attachments: [
            {
                filename: fileName,
                path: filePath,
            },
        ],
    };

    try {
        await transporter.sendMail(mailOptions);
        logToFile(`[SUCCESS] Emailed ${fileName} to Kindle.`);
    } catch (error) {
        logToFile(`[ERROR] Email failed for ${fileName}: ${error.message}`);
        throw error;
    }
}

/**
 * Converts Markdown to EPUB using Pandoc
 * Optimized for Kindle with Arabic/Mixed content support
 */
async function convertToEpub(mdPath) {
    const fileName = path.basename(mdPath, '.md');
    const epubPath = path.join(PROCESSED_DIR, `${fileName}.epub`);
    const cssPath = path.join(PROCESSED_DIR, 'kindle_style.css');

    logToFile(`[CONVERT] Starting conversion: ${path.basename(mdPath)}`);

    // 1. Detect if the file contains Arabic characters
    const content = await fs.readFile(mdPath, 'utf8');
    const hasArabic = /[\u0600-\u06FF]/.test(content);
    
    // 2. Create/Ensure custom CSS for better BiDi (Bidirectional) support on Kindle
    const customCss = `
        body { 
            direction: ${hasArabic ? 'rtl' : 'ltr'}; 
            text-align: ${hasArabic ? 'right' : 'left'}; 
            unicode-bidi: embed;
        }
        p, h1, h2, h3, h4, li { 
            direction: ${hasArabic ? 'rtl' : 'ltr'};
        }
        code, pre { 
            direction: ltr !important; 
            text-align: left !important; 
            unicode-bidi: bidi-override;
        }
    `;
    await fs.writeFile(cssPath, customCss);

    // 3. Prepare Pandoc arguments
    let pandocArgs = [
        `"${mdPath}"`,
        `-o "${epubPath}"`,
        `-t epub3`,
        `--standalone`,
        `--css "${cssPath}"`,
        `--metadata title="${fileName}"`
    ];

    if (hasArabic) {
        logToFile(`[INFO] Arabic detected in ${fileName}. Applying RTL settings and Page Progression.`);
        pandocArgs.push(`-V lang=ar`);
        pandocArgs.push(`-V dir=rtl`);
        // This is the key for scrolling/page turning direction in EPUB3
        pandocArgs.push(`-V page-progression-direction=rtl`);
    }

    const pandocCmd = `pandoc ${pandocArgs.join(' ')}`;

    return new Promise((resolve, reject) => {
        exec(pandocCmd, (error, stdout, stderr) => {
            if (error) {
                logToFile(`[ERROR] Pandoc failed: ${stderr || error.message}`);
                return reject(error);
            }
            logToFile(`[SUCCESS] Converted to EPUB (${hasArabic ? 'RTL' : 'LTR'}): ${path.basename(epubPath)}`);
            resolve(epubPath);
        });
    });
}

// Initialize watcher
const watcher = chokidar.watch(WATCH_DIR, {
    ignored: [/(^|[\/\\])\../, PROCESSED_DIR, LOG_FILE], // ignore dotfiles, processed folder, and log file
    persistent: true,
    depth: 0,
    ignoreInitial: true
});

watcher.on('add', async (filePath) => {
    if (path.extname(filePath).toLowerCase() === '.md') {
        const fileName = path.basename(filePath);
        logToFile(`[DETECTED] New file: ${fileName}`);
        
        try {
            // Wait for file lock to release
            await new Promise(r => setTimeout(r, 2000));

            // 1. Convert
            const epubPath = await convertToEpub(filePath);
            
            // 2. Send
            await sendToKindle(epubPath);

            // 3. Move original MD to processed
            const processedMdPath = path.join(PROCESSED_DIR, fileName);
            await fs.move(filePath, processedMdPath, { overwrite: true });
            
            logToFile(`[DONE] Process complete for ${fileName}. Original and EPUB are in 'processed' folder.`);

        } catch (err) {
            logToFile(`[FAILED] Processing halted for ${fileName}: ${err.message}`);
        }
    }
});

watcher.on('error', error => logToFile(`[WATCHER ERROR] ${error}`));
