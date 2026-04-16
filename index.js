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
async function sendToKindle(filePath, title) {
    const fileName = path.basename(filePath);
    logToFile(`[EMAIL] Attempting to send "${fileName}"...`);

    const mailOptions = {
        from: process.env.SMTP_USER,
        to: KINDLE_EMAIL,
        subject: title || fileName.replace('.epub', ''),
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
 * Sanitize title for a safe filename
 */
function getSafeTitle(title, fallback) {
    return title.replace(/[\\/:*?"<>|]/g, ' ').trim() || fallback;
}

/**
 * Extracts title from EPUB metadata using Pandoc
 */
async function extractTitleFromEpub(filePath) {
    const templatePath = path.join(PROCESSED_DIR, 'title_template.txt');
    if (!fs.existsSync(templatePath)) {
        await fs.writeFile(templatePath, '$title$', 'utf8');
    }
    
    return new Promise((resolve) => {
        // -t plain ensures we just get the title text without markup
        exec(`pandoc "${filePath}" --template="${templatePath}" -t plain`, (error, stdout) => {
            if (error) {
                logToFile(`[WARN] Could not extract title from EPUB: ${error.message}`);
                resolve(path.basename(filePath, '.epub'));
            } else {
                const title = stdout.trim();
                resolve(title || path.basename(filePath, '.epub'));
            }
        });
    });
}

/**
 * Converts Markdown to EPUB using Pandoc
 * Optimized for Kindle with Arabic/Mixed content support
 */
async function convertToEpub(mdPath) {
    const originalBaseName = path.basename(mdPath, '.md');
    
    // 1. Detect if the file contains Arabic characters and read content
    let content = await fs.readFile(mdPath, 'utf8');
    const hasArabic = /[\u0600-\u06FF]/.test(content);

    // 2. Use file name as title directly (no H1 or YAML extraction)
    // Per user request: "don't get title from h1 just use file name please"
    const title = originalBaseName.trim();
    const safeTitle = getSafeTitle(title, 'Converted_File');
    const epubPath = path.join(PROCESSED_DIR, `${safeTitle}.epub`);
    const cssPath = path.join(PROCESSED_DIR, 'kindle_style.css');

    logToFile(`[CONVERT] Processing: "${originalBaseName}" -> Title recognized as: "${title}"`);

    // 3. Pre-process content: Remove broken W3Schools images that start with /
    content = content.replace(/!\[.*?\]\(\/.*?\)/g, '');
    
    // Write cleaned content to a temporary file for pandoc
    const tempMdPath = path.join(PROCESSED_DIR, `temp_${originalBaseName}.md`);
    await fs.writeFile(tempMdPath, content, 'utf8');

    // 4. Create/Ensure custom CSS for better BiDi support
    const customCss = `
        body { 
            direction: ${hasArabic ? 'rtl' : 'ltr'}; 
            text-align: justify;
            unicode-bidi: embed;
            margin: 5%;
        }
        p, h1, h2, h3, h4, li { 
            direction: ${hasArabic ? 'rtl' : 'ltr'};
        }
        code, pre { 
            direction: ltr !important; 
            text-align: left !important; 
            unicode-bidi: bidi-override;
            background-color: #f4f4f4;
            display: block;
            padding: 10px;
            font-size: 0.9em;
        }
    `;
    await fs.writeFile(cssPath, customCss, 'utf8');

    // 5. Create a YAML metadata file to avoid command-line encoding/quoting issues
    const metaPath = path.join(PROCESSED_DIR, `meta_${originalBaseName}.yaml`);
    const metaContent = [
        '---',
        `title: "${title.replace(/"/g, '\\"')}"`,
        'author: "Kindle Automator"',
        `lang: "${hasArabic ? 'ar' : 'en'}"`,
        '---'
    ].join('\n');
    await fs.writeFile(metaPath, metaContent, 'utf8');

    // 6. Execute Pandoc with arguments as an array to avoid shell issues
    const pandocArgs = [
        tempMdPath,
        '-o', epubPath,
        '-t', 'epub',
        '--standalone',
        '--metadata-file', metaPath,
        '--css', cssPath,
        '--toc',
        '--toc-depth=3'
    ];

    if (hasArabic) {
        pandocArgs.push('-V', 'page-progression-direction=rtl');
    }

    return new Promise((resolve, reject) => {
        const { spawn } = require('child_process');
        const child = spawn('pandoc', pandocArgs);

        let errorOutput = '';
        child.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });

        child.on('close', (code) => {
            // Cleanup temp files
            fs.remove(tempMdPath).catch(() => {});
            fs.remove(metaPath).catch(() => {});
            
            if (code !== 0) {
                logToFile(`[ERROR] Pandoc failed (code ${code}): ${errorOutput}`);
                return reject(new Error(errorOutput));
            }
            logToFile(`[SUCCESS] Converted to EPUB (${hasArabic ? 'RTL' : 'LTR'}): "${safeTitle}.epub"`);
            resolve({ epubPath, title, safeTitle });
        });
    });
}

// Queue for processing files one by one to avoid SMTP rate limiting
const queue = [];
let isProcessing = false;

async function processQueue() {
    if (isProcessing || queue.length === 0) return;
    isProcessing = true;

    while (queue.length > 0) {
        const filePath = queue.shift();
        const extension = path.extname(filePath).toLowerCase();
        const originalFileName = path.basename(filePath);
        
        try {
            logToFile(`[QUEUED] Starting: ${originalFileName}`);
            
            let finalEpubPath;
            let finalTitle;
            let finalSafeTitle;

            if (extension === '.md') {
                // 1. Convert Markdown to EPUB
                const result = await convertToEpub(filePath);
                finalEpubPath = result.epubPath;
                finalTitle = result.title;
                finalSafeTitle = result.safeTitle;

                // Move original MD to processed folder
                const processedMdPath = path.join(PROCESSED_DIR, `${finalSafeTitle}.md`);
                await fs.move(filePath, processedMdPath, { overwrite: true });
                logToFile(`[DONE] Conversion complete. File: ${finalSafeTitle}.md`);

            } else if (extension === '.epub') {
                // 1. Use the existing filename as the title
                finalTitle = path.basename(filePath, '.epub');
                finalSafeTitle = getSafeTitle(finalTitle, 'Kindle_EPUB');
                finalEpubPath = path.join(PROCESSED_DIR, `${finalSafeTitle}.epub`);

                // Move EPUB to processed folder
                await fs.move(filePath, finalEpubPath, { overwrite: true });
                logToFile(`[DONE] EPUB processed. File: ${finalSafeTitle}.epub`);
            }
            
            // 2. Send to Kindle
            // We use the extracted title as Subject. 
            // We NO LONGER use "Convert" to avoid Kindle messing with the title.
            if (finalEpubPath) {
                await sendToKindle(finalEpubPath, finalTitle);
            }

            // Add a small delay between tasks to be safe with SMTP
            logToFile(`[INFO] Waiting 5 seconds before next task...`);
            await new Promise(r => setTimeout(r, 5000));

        } catch (err) {
            logToFile(`[FAILED] Processing halted for ${originalFileName}: ${err.message}`);
        }
    }

    isProcessing = false;
}

// Initialize watcher
const watcher = chokidar.watch(WATCH_DIR, {
    ignored: [/(^|[\/\\])\../, PROCESSED_DIR, LOG_FILE], 
    persistent: true,
    depth: 0,
    ignoreInitial: false
});

watcher.on('add', (filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.md' || ext === '.epub') {
        queue.push(filePath);
        processQueue();
    }
});

watcher.on('error', error => logToFile(`[WATCHER ERROR] ${error}`));
