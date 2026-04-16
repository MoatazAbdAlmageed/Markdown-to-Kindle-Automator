# Markdown to Kindle Automator (Windows 11)

This script monitors a specific folder for `.md` files, converts them to `.epub` using Pandoc, and sends them to your Kindle email address automatically.

## Prerequisites

- **Node.js**: Installed on your system.
- **Pandoc**: You must have Pandoc installed.
  - Download and install from [pandoc.org](https://pandoc.org/installing.html).
  - Ensure it's added to your system PATH (test by running `pandoc --version` in PowerShell).
- **Kindle Approval**:
  - Go to [Manage Your Content and Devices](https://www.amazon.com/mycd) -> Preferences -> Personal Document Settings.
  - Add your sender email (the one you'll use in `.env`) to the **Approved Personal Document E-mail List**.

## Setup

1.  Open the project folder: `C:\xampp\htdocs\md_to_epub_for_windows`.
2.  Create a `.env` file based on `.env.example`.
3.  Fill in your SMTP details and Kindle email.
4.  Install dependencies (if not already done):
    ```bash
    npm install
    ```

## Usage

Start the monitor:

```bash
node index.js
```

Any `.md` file dropped into `C:\Users\HP\Downloads\_kindle` will be:
1.  Detected.
2.  Converted to `.epub` with the title extracted from the Markdown header.
3.  Emailed to your Kindle (using the title as both the filename and email subject).
4.  Moved to the `processed/` subfolder and **renamed to match the Title**.
5.  Logged in `activity.log`.

You can check `C:\Users\HP\Downloads\_kindle\activity.log` at any time to see the status of your files (Converted, Sent, Failed).

## Background Execution (Optional)

To keep this running in the background, you can use `pm2`:

```bash
npm start
```

Or manually:

```bash
npm install -g pm2
pm2 start index.js --name kindle-monitor
pm2 save
```

## Windows Startup (Optional)

I have created an AutoHotkey (`.ahk`) script at `c:\xampp\htdocs\md_to_epub_for_windows\start_kindle_monitor.ahk`.
I have also placed a copy in your **Windows Startup** folder:
`C:\Users\HP\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup`

This script runs `npm start` (PM2) in hidden mode every time you log in, so your Kindle monitor is always ready.
