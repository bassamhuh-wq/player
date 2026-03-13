// player.js (ES Module + Hybrid Engine: HLS.js + Shaka)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase, ref, push, onValue, onDisconnect, set, remove } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyCO065Z-UcVe7tl3ebiO_Qbw1lPntna6qM",
    authDomain: "playerwatching.firebaseapp.com",
    databaseURL: "https://playerwatching-default-rtdb.firebaseio.com",
    projectId: "playerwatching",
    storageBucket: "playerwatching.firebasestorage.app",
    messagingSenderId: "1060132526791",
    appId: "1:1060132526791:web:8ef930b6919bdb17d57ce2",
    measurementId: "G-FV0ZJE5JRS"
};

// ---------------- CONFIGURATION ----------------
const CHANNEL_ID = "bein1";
const STREAM_URL = "https://joaanksa.com/bein/MN2.php?action=stream&id=116900&cat=4524";
const DRM_KEYS = "b253c726c24c7c94a3ddf9b1907e2c76:097963d6ad73c3d712a104981de0ed42";
// -----------------------------------------------

const firebaseApp = initializeApp(firebaseConfig);
const database = getDatabase(firebaseApp);

let video, wrapper, customUI;
let playPauseBtn, centerPlayPauseBtn, centerRewindBtn, centerForwardBtn, rewindBtn, forwardBtn, muteBtn, volumeSlider, timeDisplay, fullscreenBtn, expandBtn, pipBtn, castBtn, loadingSpinner, liveBadge;
let progressContainer, progressBar, bufferBar, currentBar, scrubHead;
let settingsBtn, settingsMenu, videoTrackMenu, audioTrackMenu, textTrackMenu, videoTracksList, audioTracksList, textTracksList;
let currentQuality, currentAudio, currentText;
let viewerNumber;

let hls;
let shakaPlayer;
let castContext;
let isScrubbing = false;
let liveInterval;
let manualQualityId = null; // Track manual quality selection for UI stickiness
let lastShowTime = 0; // Guard for YouTube-style toggle logic

/**
 * Update Volume UI (Global Scale Fix)
 */
function updateVolumeUI() {
    if (!video || !volumeSlider || !muteBtn) return;
    const vol = video.volume;
    const muted = video.muted;
    if (muted || vol === 0) {
        muteBtn.innerHTML = '<i class="ph-fill ph-speaker-x"></i>';
        volumeSlider.value = 0;
    } else {
        muteBtn.innerHTML = vol < 0.5 ? '<i class="ph-fill ph-speaker-low"></i>' : '<i class="ph-fill ph-speaker-high"></i>';
        volumeSlider.value = vol;
    }
}

/**
 * Initialize Hybrid Player
 */
async function initPlayer() {
    if (typeof shaka !== 'undefined') {
        shaka.polyfill.installAll();
    }

    video = document.getElementById('videoElement');
    if (video) {
        video.setAttribute('x-webkit-airplay', 'allow');
    }
    wrapper = document.getElementById('playerWrapper');
    customUI = document.getElementById('customUI');
    playPauseBtn = document.getElementById('playPauseBtn');
    centerPlayPauseBtn = document.getElementById('centerPlayPause');
    centerRewindBtn = document.getElementById('centerRewind');
    centerForwardBtn = document.getElementById('centerForward');
    rewindBtn = document.getElementById('rewindBtn');
    forwardBtn = document.getElementById('forwardBtn');
    muteBtn = document.getElementById('muteBtn');
    volumeSlider = document.getElementById('volumeSlider');
    timeDisplay = document.getElementById('timeDisplay');
    fullscreenBtn = document.getElementById('fullscreenBtn');
    expandBtn = document.getElementById('expandBtn');
    pipBtn = document.getElementById('pipBtn');
    castBtn = document.getElementById('castBtn');
    loadingSpinner = document.getElementById('loadingSpinner');
    liveBadge = document.getElementById('liveBadge');
    progressContainer = document.querySelector('.progress-container');
    progressBar = document.getElementById('progressBar');
    bufferBar = document.getElementById('bufferBar');
    currentBar = document.getElementById('currentBar');
    scrubHead = document.getElementById('scrubHead');
    settingsBtn = document.getElementById('settingsBtn');
    settingsMenu = document.getElementById('settingsMenu');
    videoTrackMenu = document.getElementById('videoTrackMenu');
    audioTrackMenu = document.getElementById('audioTrackMenu');
    textTrackMenu = document.getElementById('textTrackMenu');
    videoTracksList = document.getElementById('videoTracksList');
    audioTracksList = document.getElementById('audioTracksList');
    textTracksList = document.getElementById('textTracksList');
    currentQuality = document.getElementById('currentQuality');
    currentAudio = document.getElementById('currentAudio');
    currentText = document.getElementById('currentText');
    viewerNumber = document.getElementById('viewerNumber');

    if (!video) return;

    setupControls();
    startViewerCounter(CHANNEL_ID);
    initCast();

    loadCurrentStream();

    updateVolumeUI(); // Set initial muted icon state

    // Auto-unmute on first interaction (Browser requirement: Needs one user gesture)
async function unmuteOnce() {
    if (!video) return;
    try {
        if (video.muted) {
            video.muted = false;
            if (video.volume === 0) video.volume = 0.5;
            updateVolumeUI();
            console.log("Audio restored on first interaction");
            // Try playing if it was paused by the browser's autoplay policy
            if (video.paused) await video.play().catch(() => {});
        }
    } catch (e) {
        console.warn("Unmute failed:", e);
    }
}
    ['mousedown', 'touchstart', 'pointerdown', 'keydown'].forEach(evt => {
        document.addEventListener(evt, () => {
            unmuteOnce();
        }, { once: true, capture: true });
    });

    // Double-tap for Fullscreen (Mobile)
    let lastTap = 0;
    wrapper.addEventListener('touchstart', (e) => {
        const now = Date.now();
        if (now - lastTap < 300) {
            e.preventDefault();
            if (typeof toggleFullscreen === 'function') toggleFullscreen();
        }
        lastTap = now;
    });
}

/**
 * Fullscreen Toggle (Unified)
 */
async function toggleFullscreen() {
    if (!wrapper) return;
    try {
        if (!document.fullscreenElement) {
            if (wrapper.requestFullscreen) await wrapper.requestFullscreen();
            else if (wrapper.webkitRequestFullscreen) await wrapper.webkitRequestFullscreen();
            if (fullscreenBtn) fullscreenBtn.innerHTML = '<i class="ph-bold ph-corners-in"></i>';
            if (screen.orientation && screen.orientation.lock) {
                await screen.orientation.lock('landscape').catch(e => console.warn("Orientation lock failed:", e));
            }
        } else {
            if (document.exitFullscreen) await document.exitFullscreen();
            else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
            if (fullscreenBtn) fullscreenBtn.innerHTML = '<i class="ph-bold ph-corners-out"></i>';
            if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
        }
    } catch (err) {
        console.error("Fullscreen error:", err);
    }
}

/**
 * Load Stream with Engine Detection
 */
async function loadCurrentStream() {
    const isDash = STREAM_URL.toLowerCase().includes('.mpd');

    // Reset engines
    if (hls) { hls.destroy(); hls = null; }
    if (shakaPlayer) { await shakaPlayer.destroy(); shakaPlayer = null; }

    if (isDash) {
        console.log("Initializing Shaka Player for DASH...");
        shakaPlayer = new shaka.Player(video);

        // Error handling
        shakaPlayer.addEventListener('error', (event) => console.error('Shaka Error:', event.detail));

        // DRM Config
        if (DRM_KEYS) {
            const parts = DRM_KEYS.split(':');
            shakaPlayer.configure({
                drm: {
                    clearKeys: {
                        [parts[0]]: parts[1]
                    }
                }
            });
        }

        // General Shaka Player Configuration
        shakaPlayer.configure({
            abr: { enabled: true },
            preferredAudioLanguage: 'ar',
            preferredTextLanguage: 'ar',
            streaming: {
                lowLatencyMode: true,
                autoLowLatencyMode: true
            }
        });

        try {
            await shakaPlayer.load(STREAM_URL);
            updateTrackLists('shaka');

            // Sync current quality label for Shaka Auto
            shakaPlayer.addEventListener('variantchanged', () => {
                if (shakaPlayer.getConfiguration().abr.enabled) {
                    const active = shakaPlayer.getVariantTracks().find(t => t.active);
                    if (active) {
                        const autoLabel = document.getElementById('autoQualityLabel');
                        if (autoLabel) autoLabel.innerText = `Auto (${active.height}p)`;
                        currentQuality.innerText = `Auto (${active.height}p)`;
                    }
                }
            });

            // Jump to live edge for DASH
            const seekRange = shakaPlayer.seekRange();
            video.currentTime = seekRange.end;
        } catch (e) {
            console.error("Shaka load failed", e);
        }
    } else {
        if (window.Hls && Hls.isSupported()) {
            console.log("Initializing HLS.js for M3U8...");
            hls = new Hls({
                enableWorker: true,
                lowLatencyMode: true,
                backBufferLength: 60,
                maxBufferLength: 30,
                liveSyncDurationCount: 2, // Aim for 2 segments from edge
                liveMaxLatencyDurationCount: 5,
                maxLiveSyncPlaybackRate: 1.1,
            });

            hls.on(Hls.Events.MANIFEST_PARSED, () => updateTrackLists('hls'));

            hls.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
                const level = hls.levels[data.level];
                const autoLabel = document.getElementById('autoQualityLabel');
                if (hls.autoLevelEnabled) {
                    if (autoLabel) autoLabel.innerText = `Auto (${level.height}p)`;
                    currentQuality.innerText = `Auto (${level.height}p)`;
                } else {
                    if (autoLabel) autoLabel.innerText = `Auto`;
                }
            });


            if (DRM_KEYS) await setupEME(video, DRM_KEYS);

            hls.loadSource(STREAM_URL);
            hls.attachMedia(video);
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = STREAM_URL;
        }
    }

    video.play().catch(e => console.warn("Autoplay blocked"));
}

/**
 * Chromecast Initialization
 */
function initCast() {
    window['__onGCastApiAvailable'] = (isAvailable) => {
        if (isAvailable && window.cast) {
            castContext = cast.framework.CastContext.getInstance();
            castContext.setOptions({
                receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
                autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
            });

            castContext.addEventListener(cast.framework.CastContextEventType.SESSION_STATE_CHANGED, (event) => {
                const isCasting = event.sessionState === cast.framework.SessionState.SESSION_STARTED;
                castBtn.style.color = isCasting ? 'var(--primary)' : 'white';
                castBtn.innerHTML = isCasting ? '<i class="ph-fill ph-screencast"></i>' : '<i class="ph-bold ph-screencast"></i>';

                if (isCasting) {
                    const session = castContext.getCurrentSession();
                    const mediaInfo = new chrome.cast.media.MediaInfo(STREAM_URL, 'application/x-mpegURL');
                    const request = new chrome.cast.media.LoadRequest(mediaInfo);
                    session.loadMedia(request);
                }
            });
        }
    };
}

/**
 * Hex to ArrayBuffer for EME
 */
function hexToUint8Array(hex) {
    const arr = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) arr[i / 2] = parseInt(hex.substr(i, 2), 16);
    return arr;
}

/**
 * Configure EME for ClearKey (HLS specific)
 */
async function setupEME(video, keys) {
    if (!keys) return;
    const parts = keys.split(':');
    const kid = hexToUint8Array(parts[0]);
    const key = hexToUint8Array(parts[1]);

    const config = [{
        initDataTypes: ['cenc'],
        videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }],
    }];

    try {
        const access = await navigator.requestMediaKeySystemAccess('org.w3.clearkey', config);
        const keysInstance = await access.createMediaKeys();
        await video.setMediaKeys(keysInstance);
        const session = keysInstance.createSession();
        session.addEventListener('message', (event) => {
            const license = JSON.stringify({
                keys: [{
                    kty: 'oct',
                    kid: btoa(String.fromCharCode(...kid)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, ''),
                    k: btoa(String.fromCharCode(...key)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
                }],
                type: 'temporary'
            });
            event.target.update(new TextEncoder().encode(license));
        });
        video.addEventListener('encrypted', (e) => session.generateRequest(e.initDataType, e.initData));
    } catch (e) {
        console.warn("EME Setup failed", e);
    }
}

function startViewerCounter(channelId) {
    const viewersRef = ref(database, `viewers/${channelId}`);
    const connectedRef = ref(database, ".info/connected");

    onValue(connectedRef, (snap) => {
        if (snap.val() === true) {
            // We're connected (or reconnected)!
            const userRef = push(viewersRef);

            // Add ourselves to presence list, and remove ourselves when we disconnect.
            onDisconnect(userRef).remove().catch(err => {
                if (err) console.error("could not establish onDisconnect event", err);
            });

            // Set the presence value to true
            set(userRef, true);
        }
    });

    onValue(viewersRef, (snapshot) => {
        const total = snapshot.size || 0;
        if (viewerNumber) viewerNumber.innerText = total.toLocaleString();
    });
}

/**
 * Return to Live Edge
 */
function goToLive() {
    if (hls) {
        video.currentTime = hls.liveSyncPosition;
    } else if (shakaPlayer) {
        video.currentTime = shakaPlayer.seekRange().end;
    } else {
        video.currentTime = video.duration;
    }
}

function setupControls() {
    const togglePlay = () => video.paused ? video.play() : video.pause();
    playPauseBtn.onclick = togglePlay;
    centerPlayPauseBtn.onclick = (e) => { e.stopPropagation(); togglePlay(); };

    video.onplay = () => {
        playPauseBtn.innerHTML = '<i class="ph-fill ph-pause"></i>';
        centerPlayPauseBtn.innerHTML = '<i class="ph-fill ph-pause"></i>';
        wrapper.classList.remove('video-paused');
        resetHideTimeout();
        if (liveInterval) clearInterval(liveInterval);
    };

    video.onpause = () => {
        playPauseBtn.innerHTML = '<i class="ph-fill ph-play"></i>';
        centerPlayPauseBtn.innerHTML = '<i class="ph-fill ph-play"></i>';
        wrapper.classList.add('video-paused');
        wrapper.classList.remove('idle'); // Show controls when paused
        clearTimeout(hideTimeout);

        if (hls || shakaPlayer) {
            liveInterval = setInterval(updateLiveTime, 1000);
        }
    };

    video.onwaiting = () => { loadingSpinner.style.display = 'block'; };
    video.onplaying = () => { loadingSpinner.style.display = 'none'; };

    rewindBtn.onclick = (e) => { e.stopPropagation(); video.currentTime -= 10; resetHideTimeout(); };
    forwardBtn.onclick = (e) => { e.stopPropagation(); video.currentTime += 10; resetHideTimeout(); };
    if (centerRewindBtn) centerRewindBtn.onclick = (e) => { e.stopPropagation(); video.currentTime -= 10; resetHideTimeout(); };
    if (centerForwardBtn) centerForwardBtn.onclick = (e) => { e.stopPropagation(); video.currentTime += 10; resetHideTimeout(); };
    muteBtn.onclick = () => { video.muted = !video.muted; updateVolumeUI(); };
    volumeSlider.oninput = (e) => {
        video.volume = parseFloat(e.target.value);
        video.muted = video.volume === 0;
        updateVolumeUI();
    };

    const formatTime = (s) => {
        const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
        return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}` : `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
    };

    /**
     * Unified Time Update Logic (Live & VOD)
     */
    function updateLiveTime() {
        if (isScrubbing) return;
        const cur = video.currentTime;
        const dur = video.duration || 0;
        let isLive = false;
        let liveEdge = 0;

        if (shakaPlayer) {
            const range = shakaPlayer.seekRange();
            if (range.end - range.start > 10) {
                isLive = true;
                liveEdge = range.end;
            }
        } else if (hls && hls.liveSyncPosition) {
            isLive = true;
            liveEdge = hls.liveSyncPosition;
        }

        if (isLive) {
            const delay = Math.floor(liveEdge - cur);
            if (delay > 2) {
                timeDisplay.textContent = `-${formatTime(delay)}`;
                timeDisplay.style.color = '#ff4b2b';
            } else {
                timeDisplay.textContent = 'LIVE';
                timeDisplay.style.color = 'white';
            }
            liveBadge.classList.add('is-live');
            return;
        }

        // VOD Logic
        const percent = dur > 0 ? (cur / dur) * 100 : 0;
        currentBar.style.width = `${percent}%`;
        scrubHead.style.left = `${percent}%`;
        if (video.buffered.length > 0) bufferBar.style.width = `${(video.buffered.end(video.buffered.length - 1) / dur) * 100}%`;

        timeDisplay.style.color = 'white';
        timeDisplay.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
        liveBadge.classList.remove('is-live');
    }

    video.ontimeupdate = updateLiveTime;

    // Return to live on clock click
    timeDisplay.onclick = (e) => {
        e.stopPropagation();
        goToLive();
    };

    const handleScrub = (e) => {
        const rect = progressContainer.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        video.currentTime = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * video.duration;
    };

    progressContainer.onmousedown = (e) => {
        isScrubbing = true; handleScrub(e);
        document.onmousemove = handleScrub;
        document.onmouseup = () => { isScrubbing = false; document.onmousemove = null; };
    };

    progressContainer.ontouchstart = (e) => {
        isScrubbing = true; handleScrub(e);
        document.ontouchmove = (event) => isScrubbing && handleScrub(event);
        document.ontouchend = () => { isScrubbing = false; document.ontouchmove = null; };
    };

    fullscreenBtn.onclick = toggleFullscreen;

    const fitModes = ['contain', 'cover', 'fill', 'zoom'];
    let currentFitIndex = 0;
    expandBtn.onclick = () => {
        currentFitIndex = (currentFitIndex + 1) % fitModes.length;
        const mode = fitModes[currentFitIndex];
        video.classList.remove('fit-cover', 'fit-fill', 'fit-zoom');
        if (mode !== 'contain') video.classList.add(`fit-${mode}`);
    };

    let hideTimeout;
    const resetHideTimeout = () => {
        if (wrapper.classList.contains('idle')) {
            lastShowTime = Date.now();
        }
        wrapper.classList.remove('idle');
        clearTimeout(hideTimeout);
        // High-performance idle: only hide if video is playing. 4s for mobile comfort.
        if (!video.paused) hideTimeout = setTimeout(() => wrapper.classList.add('idle'), 4000);
    };

    // Global Listeners for interaction
    ['mousemove', 'mousedown', 'keydown', 'touchstart', 'touchmove'].forEach(evt => {
        window.addEventListener(evt, resetHideTimeout, { passive: true });
    });

    // YouTube-style Toggle UI Logic
    wrapper.onclick = (e) => {
        if (e.target === wrapper || e.target === video || e.target === customUI) {
            if (wrapper.classList.contains('idle')) {
                resetHideTimeout();
            } else {
                // Only hide if it wasn't JUST shown (prevents tap-to-show-then-hide flicker)
                if (Date.now() - lastShowTime > 300) {
                    wrapper.classList.add('idle');
                    clearTimeout(hideTimeout);
                } else {
                    // It was just shown by touchstart, so just refresh the timeout
                    resetHideTimeout();
                }
            }
        }
    };

    let castAttemptCount = 0;
    castBtn.onclick = async () => {
        let currentMethodIndex = castAttemptCount % 2; 
        castAttemptCount++;
        
        console.log(`Casting Attempt #${castAttemptCount} using Method Index ${currentMethodIndex}`);
        
        if (currentMethodIndex === 0) {
            // Step 1: Google Cast SDK
            if (typeof cast !== 'undefined' && cast.framework) {
                try {
                    const context = cast.framework.CastContext.getInstance();
                    if (context) {
                        // Ensure options are provided before starting session to fix SDK error
                        context.setOptions({
                            receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
                            autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
                        });
                        await context.requestSession();
                        return;
                    }
                } catch (err) { 
                    // Ignore dismissal errors (NotAllowedError: The prompt was dismissed)
                    if (err.code !== 'cancel' && !err.message?.includes('dismissed')) {
                        console.warn("Google Cast SDK failed:", err); 
                    }
                }
            }
            // Fallback immediately to Step 2 if Step 1 is not available
            currentMethodIndex = 1;
        }

        if (currentMethodIndex === 1) {
            // Step 2: Native Target Picker (Safari/iOS/Chrome Mobile)
            if (video.webkitShowPlaybackTargetPicker) {
                video.webkitShowPlaybackTargetPicker();
            } else if (video.remote && video.remote.prompt) {
                try {
                    await video.remote.prompt();
                } catch (err) { 
                    if (!err.message?.includes('dismissed')) {
                        console.warn("Remote Playback failed:", err); 
                    }
                }
            } else {
                alert("عذراً، لم يتم العثور على وسيلة كاست مدعومة في جهازك.");
            }
        }
    };

    pipBtn.onclick = async () => {
        try {
            if (video !== document.pictureInPictureElement) {
                await video.requestPictureInPicture();
            } else {
                await document.exitPictureInPicture();
            }
        } catch (error) {
            console.error("PiP error:", error);
        }
    };

    settingsBtn.onclick = (e) => {
        e.stopPropagation();
        settingsMenu.classList.toggle('show');
        videoTracksList.classList.add('hidden');
        audioTracksList.classList.add('hidden');
        textTracksList.classList.add('hidden');
    };

    videoTrackMenu.onclick = (e) => { e.stopPropagation(); videoTracksList.classList.toggle('hidden'); audioTracksList.classList.add('hidden'); textTracksList.classList.add('hidden'); };
    audioTrackMenu.onclick = (e) => { e.stopPropagation(); audioTracksList.classList.toggle('hidden'); videoTracksList.classList.add('hidden'); textTracksList.classList.add('hidden'); };
    textTrackMenu.onclick = (e) => { e.stopPropagation(); textTracksList.classList.toggle('hidden'); videoTracksList.classList.add('hidden'); audioTracksList.classList.add('hidden'); };

    document.onclick = () => settingsMenu.classList.remove('show');
}

/**
 * Unified Track/Quality Management
 */
function updateTrackLists(engine) {
    videoTracksList.innerHTML = '';
    audioTracksList.innerHTML = '';
    textTracksList.innerHTML = '';

    // Video/Quality for HLS
    if (engine === 'hls') {
        const autoOpt = document.createElement('div');
        const currentLevel = hls.levels[hls.currentLevel] || hls.levels[hls.loadLevel];
        const autoSuffix = (hls.autoLevelEnabled && currentLevel) ? ` (${currentLevel.height}p)` : '';

        autoOpt.className = 'track-option' + (hls.autoLevelEnabled ? ' active' : '');
        autoOpt.innerHTML = `<span id="autoQualityLabel">Auto${autoSuffix}</span>`;
        autoOpt.onclick = () => {
            hls.currentLevel = -1;
            manualQualityId = null;
            updateTrackLists('hls');
            const cur = hls.levels[hls.currentLevel] || hls.levels[hls.loadLevel];
            currentQuality.innerText = cur ? `Auto (${cur.height}p)` : 'Auto';
        };
        videoTracksList.appendChild(autoOpt);

        const bestLevels = new Map();
        hls.levels.forEach((level, index) => {
            if (!level.height || level.height === 0) return;
            let fps = level.attrs ? (level.attrs['FRAME-RATE'] || level.attrs['frame-rate']) : null;
            if (!fps && level.frameRate) fps = level.frameRate;
            const fpsKey = fps ? Math.round(fps) : 0;
            const key = `${level.height}-${fpsKey}`;
            const existing = bestLevels.get(key);
            
            if (!existing || level.bitrate > existing.level.bitrate) {
                bestLevels.set(key, { level, index, fpsText: fps ? ` / ${Math.round(fps)} fps` : '' });
            }
        });

        // Convert Map to sorted array (highest to lowest resolution)
        const sortedLevels = Array.from(bestLevels.values()).sort((a, b) => b.level.height - a.level.height);

        sortedLevels.forEach(({ level, index, fpsText }) => {
            const opt = document.createElement('div');
            opt.className = 'track-option' + (manualQualityId === `hls-${index}` ? ' active' : '');

            const bitrateMbps = (level.bitrate / 1000000).toFixed(1);
            opt.innerHTML = `<div class="track-label">${level.height}p</div><div class="track-meta">${bitrateMbps} Mbps${fpsText}</div>`;
            opt.onclick = () => {
                hls.currentLevel = index;
                manualQualityId = `hls-${index}`;
                updateTrackLists('hls');
                currentQuality.innerText = `${level.height}p`;
            };
            videoTracksList.appendChild(opt);
        });

        // Audio Tracks HLS
        if (hls.audioTracks.length === 0) {
            const none = document.createElement('div');
            none.className = 'track-option disabled';
            none.innerText = 'لا يوجد صوت إضافي';
            audioTracksList.appendChild(none);
        } else {
            hls.audioTracks.forEach((track, index) => {
                const opt = document.createElement('div');
                opt.className = 'track-option' + (hls.audioTrack === index ? ' active' : '');
                opt.innerText = track.name || track.lang || `Audio ${index + 1}`;
                opt.onclick = () => {
                    hls.audioTrack = index;
                    updateTrackLists('hls');
                    currentAudio.innerText = opt.innerText;
                };
                audioTracksList.appendChild(opt);
                if (track.lang === 'ar' && hls.audioTrack === -1) hls.audioTrack = index;
            });
        }

        // Text Tracks HLS Placeholder
        const noneText = document.createElement('div');
        noneText.className = 'track-option disabled';
        noneText.innerText = 'لا توجد ترجمة';
        textTracksList.appendChild(noneText);

    } else {
        // DASH (Shaka)
        const autoOpt = document.createElement('div');
        const isAuto = shakaPlayer.getConfiguration().abr.enabled;

        const activeVar = shakaPlayer.getVariantTracks().find(t => t.active);
        const autoSuffix = (isAuto && activeVar) ? ` (${activeVar.height}p)` : '';

        autoOpt.className = 'track-option' + (isAuto ? ' active' : '');
        autoOpt.innerHTML = `<span id="autoQualityLabel">Auto${autoSuffix}</span>`;
        autoOpt.onclick = () => {
            shakaPlayer.configure({ abr: { enabled: true } });
            manualQualityId = null;
            updateTrackLists('shaka');
            const cur = shakaPlayer.getVariantTracks().find(t => t.active);
            currentQuality.innerText = cur ? `Auto (${cur.height}p)` : 'Auto';
        };
        videoTracksList.appendChild(autoOpt);

        const variants = shakaPlayer.getVariantTracks();
        const bestVariants = new Map();
        
        variants.forEach(track => {
            if (!track.height || track.height === 0) return;
            const fpsKey = track.frameRate ? Math.round(track.frameRate) : 0;
            const key = `${track.height}-${fpsKey}`;
            const existing = bestVariants.get(key);
            if (!existing || track.bandwidth > existing.bandwidth) {
                bestVariants.set(key, track);
            }
        });

        const sortedVariants = Array.from(bestVariants.values()).sort((a, b) => b.height - a.height);

        sortedVariants.forEach((track) => {
            const opt = document.createElement('div');
            opt.className = 'track-option' + (manualQualityId === `shaka-${track.id}` ? ' active' : '');

            const bitrateMbps = (track.bandwidth / 1000000).toFixed(1);
            const fps = track.frameRate ? ` / ${Math.round(track.frameRate)} fps` : '';
            opt.innerHTML = `<div class="track-label">${track.height}p</div><div class="track-meta">${bitrateMbps} Mbps${fps}</div>`;

            opt.onclick = () => {
                shakaPlayer.configure({ abr: { enabled: false } });
                shakaPlayer.selectVariantTrack(track, true);
                manualQualityId = `shaka-${track.id}`;
                updateTrackLists('shaka');
                currentQuality.innerText = `${track.height}p`;
            };
            videoTracksList.appendChild(opt);
        });

        // Audio Tracks Shaka
        const langs = [...new Set(shakaPlayer.getAudioLanguagesAndRoles().map(l => l.language))];
        if (langs.length === 0) {
            const none = document.createElement('div');
            none.className = 'track-option disabled';
            none.innerText = 'None';
            audioTracksList.appendChild(none);
        } else {
            langs.forEach(lang => {
                const opt = document.createElement('div');
                const currentLang = shakaPlayer.getVariantTracks().find(t => t.active)?.language;
                opt.className = 'track-option' + (currentLang === lang ? ' active' : '');
                opt.innerText = lang.toUpperCase();
                opt.onclick = () => {
                    shakaPlayer.selectAudioLanguage(lang);
                    updateTrackLists('shaka');
                    currentAudio.innerText = lang.toUpperCase();
                };
                audioTracksList.appendChild(opt);
            });
        }

        // Text Tracks Shaka
        const textLangs = shakaPlayer.getTextTracks().map(t => t.language);
        if (textLangs.length === 0) {
            const none = document.createElement('div');
            none.className = 'track-option disabled';
            none.innerText = 'None';
            textTracksList.appendChild(none);
        } else {
            [...new Set(textLangs)].forEach(lang => {
                const opt = document.createElement('div');
                opt.className = 'track-option';
                opt.innerText = lang.toUpperCase();
                opt.onclick = () => { shakaPlayer.selectTextLanguage(lang); shakaPlayer.setTextTrackVisibility(true); };
                textTracksList.appendChild(opt);
            });
        }
    }
}

document.addEventListener('DOMContentLoaded', initPlayer);
