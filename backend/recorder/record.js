/**
 * Google Meet / Zoom Recording Bot
 *
 * Uses Puppeteer to join a meeting and record the audio.
 *
 * Usage:
 *   node record.js --url <meeting_url> --output <output_file> [--name <bot_name>] [--call-id <id>]
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { getStream } = require('puppeteer-stream');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

// Parse command line arguments
const args = process.argv.slice(2);
const getArg = (name) => {
    const index = args.indexOf(`--${name}`);
    return index !== -1 ? args[index + 1] : null;
};

const meetingUrl = getArg('url');
const botName = getArg('name') || 'HR Recorder';
const outputFile = getArg('output');
const callId = getArg('call-id');

if (!meetingUrl || !outputFile) {
    console.error('Usage: node record.js --url <meeting_url> --output <output_file> [--name <bot_name>]');
    process.exit(1);
}

// Ensure output directory exists
const outputDir = path.dirname(outputFile);
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

async function recordMeeting() {
    console.log(`Starting recording for: ${meetingUrl}`);

    const browser = await puppeteer.launch({
        headless: 'new',
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-web-security',
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            '--autoplay-policy=no-user-gesture-required',
            '--disable-features=AudioServiceOutOfProcess',
            '--disable-gpu'
        ]
    });

    const page = await browser.newPage();

    // Allow microphone and camera permissions
    const context = browser.defaultBrowserContext();
    await context.overridePermissions(meetingUrl, ['camera', 'microphone']);

    let stream = null;
    let fileStream = null;

    try {
        // Navigate to meeting URL
        await page.goto(meetingUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        console.log('Page loaded');

        // Detect meeting type
        const isMeet = meetingUrl.includes('meet.google.com');
        const isZoom = meetingUrl.includes('zoom.us');

        if (isMeet) {
            await joinGoogleMeet(page, botName);
        } else if (isZoom) {
            await joinZoom(page, botName);
        } else {
            throw new Error('Unsupported meeting platform');
        }

        console.log('Joined meeting, starting recording...');

        // Start recording audio
        stream = await getStream(page, {
            audio: true,
            video: false,
            mimeType: 'audio/webm'
        });

        fileStream = fs.createWriteStream(outputFile);
        stream.pipe(fileStream);

        console.log(`Recording to: ${outputFile}`);

        // Monitor meeting status
        let isRecording = true;
        let participantCheckFails = 0;

        const checkInterval = setInterval(async () => {
            try {
                const participants = await page.$$('[data-participant-id], [class*="participant"]');
                if (participants.length <= 1) {
                    participantCheckFails++;
                    if (participantCheckFails >= 3) {
                        console.log('Meeting ended (no other participants)');
                        isRecording = false;
                        clearInterval(checkInterval);
                    }
                } else {
                    participantCheckFails = 0;
                }
            } catch (e) {
                // Page might have navigated away
                isRecording = false;
                clearInterval(checkInterval);
            }
        }, 10000);

        // Handle stop signal
        process.on('SIGTERM', () => {
            console.log('Received stop signal');
            isRecording = false;
            clearInterval(checkInterval);
        });

        process.on('SIGINT', () => {
            console.log('Received interrupt signal');
            isRecording = false;
            clearInterval(checkInterval);
        });

        // Wait until recording stops
        while (isRecording) {
            await new Promise(r => setTimeout(r, 1000));
        }

        // Cleanup
        clearInterval(checkInterval);

        if (stream) {
            stream.destroy();
        }
        if (fileStream) {
            fileStream.end();
        }

        console.log('Recording finished');

    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    } finally {
        await browser.close();
    }
}

async function joinGoogleMeet(page, botName) {
    // Wait for name input or "Ask to join" button
    try {
        // Try to find name input
        await page.waitForSelector('input[type="text"]', { timeout: 15000 });
        await page.type('input[type="text"]', botName);
        console.log(`Name entered: ${botName}`);
    } catch (e) {
        console.log('Name input not found, might already have a name set');
    }

    // Try to mute camera and microphone
    try {
        // Look for camera toggle button
        const cameraBtn = await page.$('[data-is-muted="false"][aria-label*="camera" i], [aria-label*="Turn off camera" i]');
        if (cameraBtn) {
            await cameraBtn.click();
            console.log('Camera muted');
        }
    } catch (e) {
        console.log('Could not toggle camera');
    }

    try {
        // Look for microphone toggle button
        const micBtn = await page.$('[data-is-muted="false"][aria-label*="microphone" i], [aria-label*="Turn off microphone" i]');
        if (micBtn) {
            await micBtn.click();
            console.log('Microphone muted');
        }
    } catch (e) {
        console.log('Could not toggle microphone');
    }

    // Click "Join now" or "Ask to join" button
    try {
        await page.waitForSelector('button[jsname="Qx7uuf"], [data-idom-class*="join"] button', { timeout: 10000 });
        const joinButton = await page.$('button[jsname="Qx7uuf"], [data-idom-class*="join"] button');
        if (joinButton) {
            await joinButton.click();
            console.log('Joining meeting...');
        }
    } catch (e) {
        console.log('Join button not found, might already be in meeting');
    }

    // Wait for meeting room
    await page.waitForSelector('[data-participant-id], [data-self-name]', { timeout: 60000 });
    console.log('In meeting room');
}

async function joinZoom(page, botName) {
    // Zoom web client handling
    try {
        // Wait for name input
        await page.waitForSelector('#inputname, input[placeholder*="name" i]', { timeout: 15000 });

        const nameInput = await page.$('#inputname, input[placeholder*="name" i]');
        if (nameInput) {
            await nameInput.click({ clickCount: 3 });
            await nameInput.type(botName);
            console.log(`Name entered: ${botName}`);
        }
    } catch (e) {
        console.log('Name input not found');
    }

    // Click join button
    try {
        const joinButton = await page.$('button.preview-join-button, button[class*="join"]');
        if (joinButton) {
            await joinButton.click();
            console.log('Joining Zoom meeting...');
        }
    } catch (e) {
        console.log('Join button not found');
    }

    // Wait a bit for meeting to load
    await new Promise(r => setTimeout(r, 10000));
    console.log('In Zoom meeting');
}

// Run
recordMeeting()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
