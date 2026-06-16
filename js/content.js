let shortsBlockedCount = 0;
let playablesBlockedCount = 0;
let blockShorts = true;
let blockPlayables = true;
let observer = null;
let scanScheduled = false;
let redirectingFromShorts = false;
let processedItems = new WeakSet(); // Keep track of processed items to avoid double counting

// Function to check if extension context is valid
function isExtensionContextValid() {
    try {
        return typeof chrome !== 'undefined' && Boolean(chrome.runtime && chrome.runtime.id);
    } catch (e) {
        return false;
    }
}

// Function to update storage with current counts
function updateStorage() {
    if (!isExtensionContextValid()) {
        return;
    }

    chrome.storage.local.set({
        shortsBlockedCount: shortsBlockedCount,
        playablesBlockedCount: playablesBlockedCount
    });
}

function stopWatching() {
    if (observer) {
        observer.disconnect();
        observer = null;
    }
}

function scheduleHideYouTubeContent() {
    if (!isExtensionContextValid()) {
        stopWatching();
        return;
    }

    if (scanScheduled) {
        return;
    }

    scanScheduled = true;
    window.requestAnimationFrame(() => {
        scanScheduled = false;
        hideYouTubeContent();
    });
}

function redirectShortsPageIfNeeded() {
    if (!blockShorts || !window.location.pathname.includes('/shorts/')) {
        redirectingFromShorts = false;
        return false;
    }

    if (redirectingFromShorts) {
        return true;
    }

    redirectingFromShorts = true;
    shortsBlockedCount++;
    updateStorage();
    window.location.replace('https://www.youtube.com/');
    return true;
}

function hideItem(item, type) {
    if (processedItems.has(item)) {
        return false;
    }

    item.style.display = 'none';
    processedItems.add(item);

    if (type === 'shorts') {
        shortsBlockedCount++;
    } else if (type === 'playables') {
        playablesBlockedCount++;
    }

    return true;
}

// Function to hide YouTube Shorts, Playables, and the "Shorts" sidebar entry.
function hideYouTubeContent() {
    if (!isExtensionContextValid()) {
        stopWatching();
        return;
    }

    try {
        if (redirectShortsPageIfNeeded()) {
            return;
        }

        let statsUpdated = false;
        const videoItems = document.querySelectorAll('ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-reel-item-renderer');

        videoItems.forEach(item => {
            const shortsLink = item.querySelector('a[href*="/shorts/"]');
            const playablesLink = item.querySelector('a[href*="/playables/"]');

            if (blockShorts && shortsLink) {
                statsUpdated = hideItem(item, 'shorts') || statsUpdated;
            } else if (blockPlayables && playablesLink) {
                statsUpdated = hideItem(item, 'playables') || statsUpdated;
            }
        });

        if (blockShorts) {
            const reelShelves = document.querySelectorAll('ytd-rich-shelf-renderer, ytd-reel-shelf-renderer');

            reelShelves.forEach(shelf => {
                if (shelf.querySelector('a[href*="/shorts/"]')) {
                    statsUpdated = hideItem(shelf, 'shorts') || statsUpdated;
                }
            });

            document.querySelectorAll('a[title="Shorts"], a[aria-label="Shorts"]').forEach(link => {
                const sidebarEntry = link.closest('ytd-guide-entry-renderer, ytd-mini-guide-entry-renderer') || link;
                sidebarEntry.style.display = 'none';
            });
        }

        if (statsUpdated) {
            updateStorage();
        }
    } catch (error) {
        // Silently continue if YouTube changes markup while a scan is running.
    }
}

function startWatching() {
    if (!isExtensionContextValid()) {
        return;
    }

    stopWatching();
    observer = new MutationObserver(scheduleHideYouTubeContent);
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true
    });

    document.addEventListener('yt-navigate-finish', scheduleHideYouTubeContent);
    document.addEventListener('yt-page-data-updated', scheduleHideYouTubeContent);
    window.addEventListener('popstate', scheduleHideYouTubeContent);
    scheduleHideYouTubeContent();
}

// Load initial settings and counts from storage before scanning YouTube.
if (isExtensionContextValid()) {
    chrome.storage.local.get(['shortsBlockedCount', 'playablesBlockedCount', 'blockShorts', 'blockPlayables'], (result) => {
        if (chrome.runtime.lastError) {
            startWatching();
            return;
        }

        shortsBlockedCount = result.shortsBlockedCount || 0;
        playablesBlockedCount = result.playablesBlockedCount || 0;
        blockShorts = result.blockShorts !== false;
        blockPlayables = result.blockPlayables !== false;
        startWatching();
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') {
            return;
        }

        if (changes.blockShorts) {
            blockShorts = changes.blockShorts.newValue !== false;
        }

        if (changes.blockPlayables) {
            blockPlayables = changes.blockPlayables.newValue !== false;
        }

        scheduleHideYouTubeContent();
    });
}

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!isExtensionContextValid()) {
        return;
    }

    try {
        if (request.action === 'getStats') {
            sendResponse({
                shortsBlockedCount: shortsBlockedCount,
                playablesBlockedCount: playablesBlockedCount
            });
        } else if (request.action === 'resetStats') {
            shortsBlockedCount = 0;
            playablesBlockedCount = 0;
            processedItems = new WeakSet(); // Clear the set of processed items
            updateStorage(); // Update storage with reset values
            sendResponse({ success: true });
        }
    } catch (error) {
        console.log('Error handling message:', error);
    }
}); 