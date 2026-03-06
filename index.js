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
 * Optimized for Kindle compatibility
 */
function convertToEpub(mdPath) {
    return new Promise((resolve, reject) => {
        const fileName = path.basename(mdPath, '.md');
        const epubPath = path.join(PROCESSED_DIR, `${fileName}.epub`);

        logToFile(`[CONVERT] Starting conversion: ${path.basename(mdPath)}`);

        // Kindle compatibility + RTL Support (Arabic/English mix):
        // - -t epub3: Best for modern Kindle features
        // - -V lang=ar: Sets the main language to Arabic
        // - -V dir=rtl: Forces Right-to-Left direction
        // - --standalone: Essential for proper file structure
        const pandocCmd = `pandoc "${mdPath}" -o "${epubPath}" -t epub3 --standalone --metadata title="${fileName}" -V lang=ar -V dir=rtl`;

        exec(pandocCmd, (error, stdout, stderr) => {
            if (error) {
                logToFile(`[ERROR] Pandoc failed: ${stderr || error.message}`);
                return reject(error);
            }
            logToFile(`[SUCCESS] Converted to EPUB (Kindle-optimized): ${path.basename(epubPath)}`);
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
