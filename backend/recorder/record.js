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

// Configure stealth plugin
const stealth = StealthPlugin();
// Disable some evasions that cause issues with Google
stealth.enabledEvasions.delete('iframe.contentWindow');
stealth.enabledEvasions.delete('media.codecs');
puppeteer.use(stealth);

// Google account credentials from environment
const GOOGLE_EMAIL = process.env.GOOGLE_BOT_EMAIL;
const GOOGLE_PASSWORD = process.env.GOOGLE_BOT_PASSWORD;

// User agent to appear as real browser
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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

// Debug screenshot helper
async function saveScreenshot(page, name) {
    try {
        const screenshotPath = path.join(outputDir, `debug_${callId}_${name}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`Screenshot saved: ${screenshotPath}`);
    } catch (e) {
        console.log(`Could not save screenshot: ${e.message}`);
    }
}

// Login to Google account
async function loginToGoogle(page) {
    if (!GOOGLE_EMAIL || !GOOGLE_PASSWORD) {
        console.log('No Google credentials provided, skipping login');
        return false;
    }

    console.log(`Logging in to Google as ${GOOGLE_EMAIL}...`);

    try {
        // Go to Google login page
        await page.goto('https://accounts.google.com/signin/v2/identifier?flowName=GlifWebSignIn&flowEntry=ServiceLogin', {
            waitUntil: 'networkidle2',
            timeout: 60000
        });

        await saveScreenshot(page, 'login_01_start');

        // Wait for and fill email
        await page.waitForSelector('input[type="email"]', { timeout: 15000 });
        await page.type('input[type="email"]', GOOGLE_EMAIL, { delay: 50 });
        console.log('Email entered');

        // Click Next
        await page.keyboard.press('Enter');
        await new Promise(r => setTimeout(r, 3000));

        await saveScreenshot(page, 'login_02_after_email');

        // Wait for password field
        await page.waitForSelector('input[type="password"]', { visible: true, timeout: 15000 });
        await new Promise(r => setTimeout(r, 1000));

        // Fill password
        await page.type('input[type="password"]', GOOGLE_PASSWORD, { delay: 50 });
        console.log('Password entered');

        // Click Next
        await page.keyboard.press('Enter');

        // Wait for login to complete (redirect away from accounts.google.com)
        await page.waitForFunction(
            () => !window.location.href.includes('accounts.google.com/signin'),
            { timeout: 30000 }
        );

        await saveScreenshot(page, 'login_03_complete');
        console.log('Successfully logged in to Google');
        return true;

    } catch (error) {
        console.error('Google login failed:', error.message);
        await saveScreenshot(page, 'login_error');
        return false;
    }
}

async function recordMeeting() {
    console.log(`Starting recording for: ${meetingUrl}`);
    console.log(`Google credentials: ${GOOGLE_EMAIL ? 'provided' : 'not provided'}`);

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
            '--disable-gpu',
            '--window-size=1280,720'
        ]
    });

    const page = await browser.newPage();

    // Set user agent to appear as real browser
    await page.setUserAgent(USER_AGENT);
    await page.setViewport({ width: 1280, height: 720 });

    // Allow microphone and camera permissions
    const context = browser.defaultBrowserContext();
    await context.overridePermissions('https://meet.google.com', ['camera', 'microphone', 'notifications']);

    let stream = null;
    let fileStream = null;

    try {
        // Login to Google if credentials are provided
        const isMeet = meetingUrl.includes('meet.google.com');
        if (isMeet && GOOGLE_EMAIL && GOOGLE_PASSWORD) {
            const loginSuccess = await loginToGoogle(page);
            if (!loginSuccess) {
                console.log('Warning: Google login failed, will try to join as guest');
            }
        }

        // Navigate to meeting URL
        console.log(`Navigating to: ${meetingUrl}`);
        await page.goto(meetingUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        console.log('Page loaded');

        // Log page title and URL for debugging
        const pageTitle = await page.title();
        const currentUrl = page.url();
        console.log(`Page title: ${pageTitle}`);
        console.log(`Current URL: ${currentUrl}`);

        // Detect meeting type (isMeet already defined above)
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
        await saveScreenshot(page, 'error_final');
        process.exit(1);
    } finally {
        await browser.close();
    }
}

async function joinGoogleMeet(page, botName) {
    console.log('Starting Google Meet join flow...');
    await saveScreenshot(page, '01_page_loaded');

    // Wait for the page to be ready
    await new Promise(r => setTimeout(r, 3000));

    // Try to find name input
    try {
        await page.waitForSelector('input[type="text"]', { timeout: 10000 });
        const nameInput = await page.$('input[type="text"]');
        if (nameInput) {
            await nameInput.click({ clickCount: 3 });
            await nameInput.type(botName);
            console.log(`Name entered: ${botName}`);
        }
    } catch (e) {
        console.log('Name input not found, might already have a name set');
    }

    await saveScreenshot(page, '02_name_entered');

    // Try to mute camera and microphone
    try {
        const cameraBtn = await page.$('[data-is-muted="false"][aria-label*="camera" i], [aria-label*="Turn off camera" i], [aria-label*="Выключить камеру" i]');
        if (cameraBtn) {
            await cameraBtn.click();
            console.log('Camera muted');
        }
    } catch (e) {
        console.log('Could not toggle camera');
    }

    try {
        const micBtn = await page.$('[data-is-muted="false"][aria-label*="microphone" i], [aria-label*="Turn off microphone" i], [aria-label*="Выключить микрофон" i]');
        if (micBtn) {
            await micBtn.click();
            console.log('Microphone muted');
        }
    } catch (e) {
        console.log('Could not toggle microphone');
    }

    await saveScreenshot(page, '03_before_join');

    // Find and click join button - multiple selectors for different languages
    const joinSelectors = [
        'button[jsname="Qx7uuf"]',
        '[data-idom-class*="join"] button',
        'button[aria-label*="Join now" i]',
        'button[aria-label*="Ask to join" i]',
        'button[aria-label*="Присоединиться" i]',
        'button[aria-label*="Попросить присоединиться" i]',
        'button:has-text("Join now")',
        'button:has-text("Ask to join")',
        'button:has-text("Присоединиться")'
    ];

    let joinClicked = false;
    for (const selector of joinSelectors) {
        try {
            const btn = await page.$(selector);
            if (btn) {
                const isVisible = await btn.isIntersectingViewport();
                if (isVisible) {
                    await btn.click();
                    console.log(`Join button clicked (${selector})`);
                    joinClicked = true;
                    break;
                }
            }
        } catch (e) {
            // Try next selector
        }
    }

    // If no specific button found, try to find any button with join-like text
    if (!joinClicked) {
        try {
            const buttons = await page.$$('button');
            for (const btn of buttons) {
                const text = await btn.evaluate(el => el.textContent || el.innerText);
                if (text && (text.includes('Join') || text.includes('Присоединиться') || text.includes('join'))) {
                    await btn.click();
                    console.log(`Join button clicked (by text: ${text})`);
                    joinClicked = true;
                    break;
                }
            }
        } catch (e) {
            console.log('Could not find join button by text');
        }
    }

    await saveScreenshot(page, '04_after_join_click');

    // Wait for meeting room with extended timeout and multiple selectors
    console.log('Waiting to enter meeting room...');

    const meetingRoomSelectors = [
        '[data-participant-id]',
        '[data-self-name]',
        '[data-meeting-title]',
        '[class*="participant"]',
        '[aria-label*="participant" i]',
        '[class*="call-controls"]'
    ];

    let inMeeting = false;
    const startTime = Date.now();
    const maxWait = 120000; // 2 minutes

    while (!inMeeting && (Date.now() - startTime) < maxWait) {
        for (const selector of meetingRoomSelectors) {
            try {
                const element = await page.$(selector);
                if (element) {
                    console.log(`In meeting room (found: ${selector})`);
                    inMeeting = true;
                    break;
                }
            } catch (e) {
                // Continue checking
            }
        }

        if (!inMeeting) {
            // Check if we're in "waiting for host" state
            const pageContent = await page.content();
            if (pageContent.includes('waiting') || pageContent.includes('ожидани')) {
                console.log('Waiting for host to admit...');
            }
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    await saveScreenshot(page, '05_meeting_status');

    if (!inMeeting) {
        throw new Error('Could not join meeting - timed out waiting for meeting room');
    }

    console.log('Successfully joined meeting');
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
