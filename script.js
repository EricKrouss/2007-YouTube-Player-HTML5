console.log('[YTDBG] script.js loaded at', new Date().toISOString(), 'URL:', window.location.href);
window.addEventListener('error', (e) => {
  console.error('[YTDBG] window.onerror', e.message, e.filename, e.lineno, e.colno, e.error);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[YTDBG] unhandledrejection', e.reason);
});

let isDraggingTimeline = false;
let isDraggingVolume = false;
let videoDuration = 0;
let earliestWatchedTime = 0;
let previousVolume = 100;
let isYouTubeMode = false;
let ytPlayer = null;
let ytPollInterval = null;

const myVideo = document.getElementById('myVideo');
const ytContainer = document.getElementById('ytContainer');
const loadingIndicator = document.getElementById('loadingIndicator');
const playPauseBtn = document.getElementById('playPauseBtn');
const rewindBtn = document.getElementById('rewindBtn');
const progressRed = document.getElementById('progressRed');
const progressLoaded = document.getElementById('progressLoaded');
const progressHandle = document.getElementById('progressHandle');
const timeCurrent = document.getElementById('timeCurrent');
const timeTotal = document.getElementById('timeTotal');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const progressSection = document.querySelector('.progress-section');
const volumeTrack = document.getElementById('volumeTrack');
const volumeHandle = document.getElementById('volumeHandle');
const volumeLevel = document.getElementById('volumeLevel');
const volumeBtn = document.getElementById('volumeBtn');
const endedButtons = document.getElementById('endedButtons');
const shareBtn = document.getElementById('shareBtn');
const watchAgainBtn = document.getElementById('watchAgainBtn');
const ytLoaderForm = document.getElementById('ytLoaderForm');
const ytUrlInput = document.getElementById('ytUrlInput');
const ytInputError = document.getElementById('ytInputError');
endedButtons.style.display = 'none';
loadingIndicator.style.zIndex = '99999999999999999999999999';
loadingIndicator.style.position = 'absolute';
loadingIndicator.style.top = '50%';
loadingIndicator.style.left = '50%';
loadingIndicator.style.transform = 'translate(-50%, -50%)';
loadingIndicator.style.backgroundRepeat = 'no-repeat';
loadingIndicator.style.backgroundPosition = 'center';
loadingIndicator.style.backgroundSize = 'contain';
loadingIndicator.style.pointerEvents = 'none';

// Decide playback provider based on URL (?yt=VIDEO_ID_OR_URL)
function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

function getInitialYouTubeInput() {
  // Accept several common param names or a full YouTube URL anywhere in the query/hash
  const direct = getQueryParam('yt') || getQueryParam('v') || getQueryParam('url') || getQueryParam('u');
  if (direct) return direct;

  // Scan entire decoded query string for a YouTube URL
  const qs = window.location.search ? window.location.search.slice(1) : '';
  if (qs) {
    try {
      const decoded = decodeURIComponent(qs);
      const m1 = decoded.match(/https?:\/\/[^\s&]*youtube\.com[^\s]*/i);
      const m2 = decoded.match(/https?:\/\/youtu\.be\/[^\s&]*/i);
      if (m1 && m1[0]) return m1[0];
      if (m2 && m2[0]) return m2[0];
    } catch (_) {}
  }

  // Check hash for yt-like inputs, e.g. #yt=..., #v=..., or a raw URL
  const hash = window.location.hash ? window.location.hash.slice(1) : '';
  if (hash) {
    try {
      const hp = new URLSearchParams(hash);
      const hval = hp.get('yt') || hp.get('v') || hp.get('url') || hp.get('u');
      if (hval) return hval;
    } catch (_) {
      // Not a param list; fall through and try to match a URL directly
      const m1 = hash.match(/https?:\/\/[^\s&]*youtube\.com[^\s]*/i);
      const m2 = hash.match(/https?:\/\/youtu\.be\/[^\s&]*/i);
      if (m1 && m1[0]) return m1[0];
      if (m2 && m2[0]) return m2[0];
    }
  }

  return null;
}

function normalizeUrlMaybe(input) {
  if (!input) return '';
  // Trim whitespace and common surrounding punctuation or prefixes (e.g., '@', parentheses)
  let trimmed = input.trim();
  // If text contains a URL somewhere inside, extract the first http(s) URL substring
  const urlMatch = trimmed.match(/https?:\/\/[\w\-._~:/?#[\]@!$&'()*+,;=%]+/i);
  if (urlMatch) {
    trimmed = urlMatch[0];
  }
  // Remove leading '@' or surrounding brackets/parentheses
  trimmed = trimmed.replace(/^[@\s]+/, '').replace(/^[(<\[]+/, '').replace(/[)\]>]+$/, '');
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return 'https://' + trimmed;
}

function extractYouTubeId(input) {
  if (!input) return null;
  const idLike = /^[a-zA-Z0-9_-]{11}$/;
  if (idLike.test(input)) return input;
  try {
    const url = new URL(normalizeUrlMaybe(input));
    const host = url.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      return url.pathname.slice(1);
    }
    if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
      if (url.searchParams.get('v')) {
        return url.searchParams.get('v');
      }
    }
    const shorts = url.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
    if (shorts) return shorts[1];
    const embed = url.pathname.match(/\/(?:embed|live)\/([a-zA-Z0-9_-]{11})/);
    if (embed) return embed[1];
  } catch (_) {
    // not a URL, fallthrough
  }
  return null;
}

function extractStartSeconds(input) {
  try {
    const url = new URL(normalizeUrlMaybe(input));
    let t = url.searchParams.get('t') || url.searchParams.get('start');
    if (!t) return 0;
    if (/^\d+$/.test(t)) return parseInt(t, 10);
    let seconds = 0;
    const m = t.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/i);
    if (m) {
      seconds += (parseInt(m[1] || '0', 10) * 3600);
      seconds += (parseInt(m[2] || '0', 10) * 60);
      seconds += (parseInt(m[3] || '0', 10));
    }
    return seconds;
  } catch (_) {
    return 0;
  }
}

const initialYtInput = getInitialYouTubeInput();
const ytVideoId = extractYouTubeId(initialYtInput);
const ytStartAt = extractStartSeconds(initialYtInput) || 0;
console.log('[YTDBG] Initial detection', { initialYtInput, ytVideoId, ytStartAt });
isYouTubeMode = !!ytVideoId;
console.log('[YTDBG] isYouTubeMode set to', isYouTubeMode);

if (!isYouTubeMode) {
  myVideo.addEventListener('loadstart', startLoadingAnimation);
  myVideo.addEventListener('loadeddata', stopLoadingAnimation);
}

if (!isYouTubeMode) {
  myVideo.addEventListener('loadedmetadata', () => {
    videoDuration = myVideo.duration;
    updateProgress();
    updateBuffered();
    let initialVolPercent = myVideo.volume * 100;
    setVolume(initialVolPercent);

    endedButtons.style.display = 'none';
    myVideo.play();
  });
}

if (!isYouTubeMode) {
  myVideo.addEventListener('timeupdate', () => {
    scheduleUIUpdate();
  });
}

if (!isYouTubeMode) {
  myVideo.addEventListener('progress', () => {
    scheduleUIUpdate();
  });
}

if (!isYouTubeMode) {
  myVideo.addEventListener('ended', () => {
    myVideo.style.display = 'none';
    endedButtons.style.display = 'flex';
  });
}

if (!isYouTubeMode) {
  myVideo.addEventListener('play', () => {
    playPauseBtn.classList.add('playing');
    endedButtons.style.display = 'none';
    myVideo.style.display = 'block';
  });
  myVideo.addEventListener('pause', () => {
    playPauseBtn.classList.remove('playing');
  });
}


shareBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(window.location.href).catch(err => {
    console.error('Failed to copy URL:', err);
  });
});

// Watch Again button: On click, rewind and play the video
watchAgainBtn.addEventListener('click', () => {
  // Hide the ended buttons and show the video again
  endedButtons.style.display = 'none';
  myVideo.style.display = 'block';

  // Reset earliestWatchedTime so the red bar clears
  earliestWatchedTime = 0;
  // Force a reload of the video to discard previously buffered data

// Also reset earliestWatchedTime to clear the red bar visually
earliestWatchedTime = 0;

  // Reset the video playback
  myVideo.currentTime = 0;
  myVideo.play();
  
  // Update the timeline after resetting earliestWatchedTime
  updateProgress();
  updateBuffered();
});

let loadingFrame = 1;
const loadingTotalFrames = 22;
let loadingInterval = null;
const loadingFrameDelay = 100; // ms between loading frames

function updateLoadingFrame() {
    if (loadingFrame < loadingTotalFrames) {
      loadingFrame++;
      loadingIndicator.style.backgroundImage = `url('assets/loading_frames/${loadingFrame}.png')`;
    } else {
      // Loop back to frame 1, no fade needed, just continuous loop
      loadingFrame = 1;
      loadingIndicator.style.backgroundImage = `url('assets/loading_frames/1.png')`;
    }
  }
  
  function startLoadingAnimation() {
    if (!loadingInterval) {
      loadingFrame = 1;
      loadingIndicator.style.backgroundImage = `url('assets/loading_frames/1.png')`;
      loadingIndicator.style.display = 'block'; // show the indicator
      loadingInterval = setInterval(updateLoadingFrame, loadingFrameDelay);
    }
  }
  
  function stopLoadingAnimation() {
    if (loadingInterval) {
      clearInterval(loadingInterval);
      loadingInterval = null;
      loadingIndicator.style.display = 'none'; // hide the indicator
      // reset to frame 1
      loadingFrame = 1;
      loadingIndicator.style.backgroundImage = `url('assets/loading_frames/1.png')`;
    }
  }

// Video buffering events
// 'waiting' event fires when the video is buffering/waiting for data
if (!isYouTubeMode) {
  myVideo.addEventListener('waiting', startLoadingAnimation);
  myVideo.addEventListener('playing', stopLoadingAnimation);
  myVideo.addEventListener('canplay', stopLoadingAnimation);
  myVideo.addEventListener('canplaythrough', stopLoadingAnimation);
}

// Provider abstraction
function providerGetDuration() {
  if (isYouTubeMode) {
    return ytPlayer ? ytPlayer.getDuration() : 0;
  }
  return videoDuration || (myVideo ? myVideo.duration : 0) || 0;
}

function providerGetCurrentTime() {
  if (isYouTubeMode) {
    return ytPlayer ? ytPlayer.getCurrentTime() : 0;
  }
  return myVideo.currentTime;
}

function providerSeekTo(seconds) {
  if (isYouTubeMode) {
    if (ytPlayer) ytPlayer.seekTo(seconds, true);
  } else {
    myVideo.currentTime = seconds;
  }
}

function providerPlay() {
  if (isYouTubeMode) {
    if (ytPlayer) ytPlayer.playVideo();
  } else {
    myVideo.play();
  }
}

function providerPause() {
  if (isYouTubeMode) {
    if (ytPlayer) ytPlayer.pauseVideo();
  } else {
    myVideo.pause();
  }
}

function providerIsPaused() {
  if (isYouTubeMode) {
    if (!ytPlayer || typeof YT === 'undefined') return true;
    const s = ytPlayer.getPlayerState();
    return s !== YT.PlayerState.PLAYING;
  }
  return myVideo.paused || myVideo.ended;
}

function providerGetLoadedEnd() {
  const duration = providerGetDuration();
  if (duration <= 0) return 0;
  if (isYouTubeMode) {
    if (!ytPlayer) return 0;
    const fraction = ytPlayer.getVideoLoadedFraction();
    return fraction * duration;
  } else {
    if (!myVideo.buffered || myVideo.buffered.length === 0) return 0;
    return myVideo.buffered.end(myVideo.buffered.length - 1);
  }
}

function togglePlayPause() {
  if (providerIsPaused()) {
    providerPlay();
    playPauseBtn.classList.add('playing');
  } else {
    providerPause();
    playPauseBtn.classList.remove('playing');
  }
}

function rewindVideo() {
  providerSeekTo(0);
  earliestWatchedTime = 0;
  updateProgress();
  updateBuffered();
}



function updateProgress() {
  const duration = providerGetDuration();
  if (!duration) return;
  const currentTime = providerGetCurrentTime();
  const timelineWidth = progressSection.clientWidth;
  const earliestPixel = Math.round((earliestWatchedTime / duration) * timelineWidth);
  const currentPixel = Math.round((currentTime / duration) * timelineWidth);
  const watchedWidth = Math.max(0, currentPixel - earliestPixel);

  progressRed.style.left = earliestPixel + 'px';
  progressRed.style.width = watchedWidth + 'px';

  const handleX = currentPixel - Math.round(progressHandle.offsetWidth / 2);
  progressHandle.style.left = handleX + 'px';

  updateTimeDisplay(currentTime, duration);
}

// Removed duplicate percent-based updateBuffered; using pixel-precise version below
function updateTimeDisplay(currentTime, duration) {
  // For currentTime, pass a flag to formatTime to zero-pad minutes
  timeCurrent.textContent = formatTime(currentTime, true);
  timeTotal.textContent = duration ? formatTime(duration, false) : '0:00';
}

function formatTime(seconds, isCurrent) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);

  // If it's current time (isCurrent = true), zero-pad the minutes if < 10
  // Otherwise, leave minutes as is for total time
  const minutesStr = isCurrent ? (m < 10 ? '0' + m : m) : m;
  const secondsStr = s < 10 ? '0' + s : s;

  return minutesStr + ':' + secondsStr;
}

function updateBuffered() {
  const duration = providerGetDuration();
  if (!duration) return;
  const bufferEnd = providerGetLoadedEnd();
  const timelineWidth = progressSection.clientWidth;

  const loadedDuration = Math.max(0, bufferEnd - earliestWatchedTime);
  const earliestPixel = Math.round((earliestWatchedTime / duration) * timelineWidth);
  const loadedWidth = Math.round((loadedDuration / duration) * timelineWidth);

  progressLoaded.style.left = earliestPixel + 'px';
  progressLoaded.style.width = loadedWidth + 'px';
}

/* Timeline dragging */
function startTimelineDrag(e) {
  isDraggingTimeline = true;
  progressHandle.classList.add('active');
  document.addEventListener('mousemove', dragTimeline);
  document.addEventListener('mouseup', stopTimelineDrag);
  e.preventDefault();
}

function dragTimeline(e) {
  if (!isDraggingTimeline) return;
  e.preventDefault();
  const rect = progressSection.getBoundingClientRect();
  let x = e.clientX - rect.left;
  x = Math.max(0, Math.min(x, rect.width));
  const duration = providerGetDuration();
  const newTime = (x / rect.width) * duration;

  const watchedDuration = Math.max(0, newTime - earliestWatchedTime);
  const earliestPixel = (earliestWatchedTime / duration) * progressSection.clientWidth;
  const watchedWidth = (watchedDuration / duration) * progressSection.clientWidth;
  progressRed.style.left = earliestPixel + 'px';
  progressRed.style.width = watchedWidth + 'px';

  const handlePercent = (newTime / duration) * 100;
  const handleX = (handlePercent / 100) * progressSection.clientWidth;
  progressHandle.style.left = (handleX - (progressHandle.offsetWidth / 2)) + 'px';
  updateTimeDisplay(newTime, videoDuration);
}

function stopTimelineDrag(e) {
  if (!isDraggingTimeline) return;
  isDraggingTimeline = false;
  progressHandle.classList.remove('active');
  document.removeEventListener('mousemove', dragTimeline);
  document.removeEventListener('mouseup', stopTimelineDrag);

  const rect = progressSection.getBoundingClientRect();
  let x = e.clientX - rect.left;
  x = Math.max(0, Math.min(x, rect.width));
  const duration = providerGetDuration();
  const newTime = (x / rect.width) * duration;

  earliestWatchedTime = newTime;
  // Clear visually:
  progressRed.style.width = '0px';
  progressRed.style.left = ((earliestWatchedTime / duration) * progressSection.clientWidth) + 'px';
  progressLoaded.style.width = '0px';
  progressLoaded.style.left = ((earliestWatchedTime / duration) * progressSection.clientWidth) + 'px';
  
  updateProgress();
  updateBuffered();
  
}

progressHandle.addEventListener('mousedown', startTimelineDrag);

progressSection.addEventListener('click', (e) => {
  if (isDraggingTimeline) return;
  const rect = progressSection.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const duration = providerGetDuration();
  const newTime = (clickX / rect.width) * duration;
  earliestWatchedTime = newTime;
  providerSeekTo(newTime);
  updateProgress();
  updateBuffered();
});

/* Volume Logic */
function updateVolumeIcon(volPercent) {
  let iconFile;
  if (volPercent === 0) {
    iconFile = './assets/volume/volume_icon.png';
    volumeBtn.classList.add('muted');
  } else if (volPercent <= 25) {
    iconFile = './assets/volume/volume_icon_1.png';
    volumeBtn.classList.remove('muted');
  } else if (volPercent <= 50) {
    iconFile = './assets/volume/volume_icon_2.png';
    volumeBtn.classList.remove('muted');
  } else if (volPercent <= 75) {
    iconFile = './assets/volume/volume_icon_3.png';
    volumeBtn.classList.remove('muted');
  } else {
    iconFile = './assets/volume/volume_icon_4.png';
    volumeBtn.classList.remove('muted');
  }

  volumeBtn.style.backgroundImage = `url('${iconFile}')`;
  volumeBtn.style.backgroundRepeat = 'no-repeat';
  volumeBtn.style.backgroundPosition = 'center';
  volumeBtn.style.backgroundSize = 'contain';
}

function setVolume(volPercent) {
  volPercent = Math.max(0, Math.min(100, volPercent));
  if (isYouTubeMode) {
    if (ytPlayer) {
      ytPlayer.setVolume(volPercent);
      if (volPercent === 0) ytPlayer.mute(); else ytPlayer.unMute();
    }
  } else {
    myVideo.volume = volPercent / 100;
  }
  volumeLevel.style.width = volPercent + '%';

  const trackWidth = volumeTrack.clientWidth;
  const handleX = (volPercent / 100) * trackWidth;
  volumeHandle.style.left = (handleX - (volumeHandle.offsetWidth / 2)) + 'px';

  updateVolumeIcon(volPercent);
}

volumeBtn.addEventListener('click', () => {
  let currentVolPercent = isYouTubeMode ? (ytPlayer ? ytPlayer.getVolume() : 100) : (myVideo.volume * 100);
  if (currentVolPercent > 0) {
    previousVolume = currentVolPercent;
    setVolume(0);
  } else {
    setVolume(previousVolume);
  }
});

function startVolumeDrag(e) {
  isDraggingVolume = true;
  volumeHandle.classList.add('active');
  document.addEventListener('mousemove', dragVolume);
  document.addEventListener('mouseup', stopVolumeDrag);
  e.preventDefault(); 
}

function dragVolume(e) {
  if (!isDraggingVolume) return;
  e.preventDefault();
  const rect = volumeTrack.getBoundingClientRect();
  let x = e.clientX - rect.left;
  const width = rect.width;
  x = Math.max(0, Math.min(x, width));
  let volPercent = (x / width) * 100;
  setVolume(volPercent);
}

function stopVolumeDrag(e) {
  if (!isDraggingVolume) return;
  isDraggingVolume = false;
  volumeHandle.classList.remove('active');
  document.removeEventListener('mousemove', dragVolume);
  document.removeEventListener('mouseup', stopVolumeDrag);
}

volumeHandle.addEventListener('mousedown', startVolumeDrag);
// Clicking anywhere on the volume slider should set the volume to that point
volumeTrack.addEventListener('click', (e) => {
  const rect = volumeTrack.getBoundingClientRect();
  let x = e.clientX - rect.left;
  const width = rect.width;
  x = Math.max(0, Math.min(x, width));
  let volPercent = (x / width) * 100;
  setVolume(volPercent);
});

const controlBarHeight = 31; // Adjust if your control bar height differs

function adjustVideoSizeForFullscreen() {
  const videoArea = document.querySelector('.video-area');

  if (document.fullscreenElement) {
    // In fullscreen mode, set .video-area to fill the screen except the control bar space
    videoArea.style.height = `calc(100vh - ${controlBarHeight}px)`;
    videoArea.style.width = '100%';
    videoArea.style.display = 'flex';
    videoArea.style.alignItems = 'center';
    videoArea.style.justifyContent = 'center';

    // Set the video to fill vertical space
    myVideo.style.width = 'auto';
    myVideo.style.height = '100%';
    myVideo.style.objectFit = 'contain';
  } else {
    // In windowed mode, revert to original sizing
    videoArea.style.height = 'auto';
    videoArea.style.width = '100%';
    videoArea.style.display = '';
    videoArea.style.alignItems = '';
    videoArea.style.justifyContent = '';

    myVideo.style.width = '100%';
    myVideo.style.height = 'auto';
    myVideo.style.objectFit = 'contain';
  }
}


/* Fullscreen Toggle */
function toggleFullscreen() {
  const container = document.querySelector('.player-container');
  if (!document.fullscreenElement) {
    container.requestFullscreen().catch(err => {
      console.error("Error attempting to enter fullscreen:", err);
    });
  } else {
    document.exitFullscreen().catch(err => {
      console.error("Error attempting to exit fullscreen:", err);
    });
  }
}



playPauseBtn.addEventListener('click', togglePlayPause);
rewindBtn.addEventListener('click', rewindVideo);
fullscreenBtn.addEventListener('click', toggleFullscreen);

/* Animated Fullscreen Button Frames */
let fullscreenFrame = 1;
const totalFrames = 24;
let fullscreenInterval = null;
const frameDelay = 40; // ms between frames


function updateFullscreenFrame() {
  if (fullscreenFrame < totalFrames) {
    fullscreenFrame++;
    fullscreenBtn.style.backgroundImage = `url('assets/fullscreen_button/${fullscreenFrame}.png')`;
  } else {
    fullscreenFrame = 1;
    fullscreenBtn.style.backgroundImage = `url('assets/fullscreen_button/1.png')`;
  }
}

function startFullscreenAnimation() {
  if (!fullscreenInterval) {
    fullscreenFrame = 1;
    fullscreenBtn.style.backgroundImage = `url('assets/fullscreen_button/1.png')`;
    fullscreenBtn.style.opacity = 1; // Ensure fully visible
    fullscreenInterval = setInterval(updateFullscreenFrame, frameDelay);
  }
}

function stopFullscreenAnimation() {
  if (fullscreenInterval) {
    clearInterval(fullscreenInterval);
    fullscreenInterval = null;
    fullscreenFrame = 1;
    fullscreenBtn.style.backgroundImage = `url('assets/fullscreen_button/1.png')`;
  }
}

function attachFullscreenHoverEvents() {
  fullscreenBtn.addEventListener('mouseenter', startFullscreenAnimation);
  fullscreenBtn.addEventListener('mouseleave', stopFullscreenAnimation);
}

function detachFullscreenHoverEvents() {
  fullscreenBtn.removeEventListener('mouseenter', startFullscreenAnimation);
  fullscreenBtn.removeEventListener('mouseleave', stopFullscreenAnimation);
}

// Initially attach hover events (for normal mode)
attachFullscreenHoverEvents();
    
    // Toggle fullscreen function
    // Existing code above remains unchanged...

        // Handle fullscreen changes
        document.addEventListener('fullscreenchange', () => {
          if (document.fullscreenElement) {
            stopFullscreenAnimation();
            detachFullscreenHoverEvents();
            fullscreenBtn.style.backgroundImage = `url('assets/fullscreen_button/exit_fullscreen.png')`;
            fullscreenBtn.style.backgroundSize = '45px 15px';
            fullscreenBtn.classList.add('exit-icon');
          } else {
            fullscreenBtn.classList.remove('exit-icon');
            fullscreenBtn.style.backgroundImage = `url('assets/fullscreen_button/1.png')`;
            fullscreenBtn.style.backgroundSize = '25px 18px';
            attachFullscreenHoverEvents();
          }
        
          // Adjust video size immediately for fullscreen/windowed
          adjustVideoSizeForFullscreen();
          
          // ResizeObserver will handle updateProgress()/updateBuffered() instantly upon layout changes
        });


// Pressing Escape should exit fullscreen as if pressing the exit fullscreen button
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.fullscreenElement) {
    document.exitFullscreen().catch(err => console.error("Error attempting to exit fullscreen:", err));
  }
});

// Use a ResizeObserver to update timeline immediately whenever its width changes
const observer = new ResizeObserver(() => {
  // Called whenever progressSection size changes
  scheduleUIUpdate();
});

observer.observe(progressSection);

function handleFullscreenChange() {
  if (document.fullscreenElement) {
    // Entered fullscreen
    stopFullscreenAnimation();
    detachFullscreenHoverEvents();
    fullscreenBtn.style.backgroundImage = `url('assets/fullscreen_button/exit_fullscreen.png')`;
    fullscreenBtn.style.backgroundSize = '45px 15px';
    fullscreenBtn.classList.add('exit-icon');
  } else {
    // Exited fullscreen
    fullscreenBtn.classList.remove('exit-icon');
    fullscreenBtn.style.backgroundImage = `url('assets/fullscreen_button/1.png')`;
    fullscreenBtn.style.backgroundSize = '25px 18px';
    attachFullscreenHoverEvents();
  }

  // Adjust video size based on fullscreen state
  adjustVideoSizeForFullscreen();

  // If using ResizeObserver to instantly recalc timeline:
  // The ResizeObserver callback will call updateProgress() and updateBuffered()
  // as soon as the layout stabilizes. No extra delays needed.
}
    

function waitForStableLayout() {
  return new Promise((resolve) => {
    let lastWidth = null;
    let stableFrames = 0;

    function checkStability() {
      const currentWidth = progressSection.offsetWidth;
      if (lastWidth === currentWidth) {
        // Width hasn't changed since last frame
        stableFrames++;
      } else {
        // Width changed, reset counter
        stableFrames = 0;
      }

      lastWidth = currentWidth;

      // Consider stable if unchanged for at least 2 consecutive frames
      if (stableFrames >= 5) {
        resolve();
      } else {
        requestAnimationFrame(checkStability);
      }
    }

    // Start checking
    requestAnimationFrame(checkStability);
  });
}
    
// Preload UI image assets to prevent flicker when first shown
function preloadImages(paths) {
  const images = [];
  for (const path of paths) {
    const img = new Image();
    img.src = path;
    images.push(img);
  }
  return images;
}

function preloadUIAssets() {
  const fullscreenFrames = [];
  for (let i = 1; i <= 24; i++) {
    fullscreenFrames.push(`assets/fullscreen_button/${i}.png`);
  }
  fullscreenFrames.push('assets/fullscreen_button/exit_fullscreen.png');

  const loadingFrames = [];
  for (let i = 1; i <= 22; i++) {
    loadingFrames.push(`assets/loading_frames/${i}.png`);
  }

  const volumeIcons = [
    'assets/volume/volume_icon.png',
    'assets/volume/volume_icon_1.png',
    'assets/volume/volume_icon_2.png',
    'assets/volume/volume_icon_3.png',
    'assets/volume/volume_icon_4.png'
  ];

  preloadImages([...fullscreenFrames, ...loadingFrames, ...volumeIcons]);
}

// Coalesce UI updates to animation frames to avoid layout thrash/flicker
let rafId = null;
function scheduleUIUpdate() {
  if (rafId !== null) return;
  rafId = requestAnimationFrame(() => {
    rafId = null;
    updateProgress();
    updateBuffered();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  console.log('[YTDBG] DOMContentLoaded. URL:', window.location.href);
  preloadUIAssets();
  if (isYouTubeMode) {
    console.log('[YTDBG] Entering YouTube mode with', { ytVideoId, ytStartAt });
    // Use unified flow to enter YouTube mode and honor start time
    startLoadingAnimation();
    enterYouTubeMode(ytVideoId, ytStartAt).catch((err) => {
      console.error('[YTDBG] enterYouTubeMode failed:', err);
      // If anything fails, revert gracefully to HTML5 video
      isYouTubeMode = false;
      ytContainer.style.display = 'none';
      myVideo.style.display = 'block';
      stopLoadingAnimation();
      myVideo.play().catch(e => console.warn('[YTDBG] HTML5 autoplay failed:', e));
    });
  } else {
    console.log('[YTDBG] Staying in HTML5 mode, autoplaying local video.');
    // HTML5 autoplay
    myVideo.play().catch(e => console.warn('[YTDBG] HTML5 autoplay failed:', e));
  }

  if (ytLoaderForm) {
    ytLoaderForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const link = ytUrlInput.value.trim();
      const id = extractYouTubeId(link);
      const startAt = extractStartSeconds(link) || 0;
      if (!id) {
        if (ytInputError) ytInputError.textContent = 'Enter a valid YouTube URL (youtube.com or youtu.be).';
        ytUrlInput.focus();
        return;
      }
      if (ytInputError) ytInputError.textContent = '';
      startLoadingAnimation();
      await enterYouTubeMode(id, startAt);
    });
  }
});

function ensureYouTubeAPI() {
  return new Promise((resolve) => {
    if (window.YT && window.YT.Player) {
      console.log('[YTDBG] YouTube Iframe API already present.');
      return resolve();
    }
    const existing = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
    if (!existing) {
      console.log('[YTDBG] Injecting YouTube Iframe API <script>.');
      const tag = document.createElement('script');
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    } else {
      console.log('[YTDBG] YouTube Iframe API script tag already in DOM.');
    }
    const t0 = Date.now();
    const checkReady = () => {
      if (window.YT && window.YT.Player) {
        console.log('[YTDBG] YouTube Iframe API ready after', (Date.now() - t0), 'ms');
        return resolve();
      }
      setTimeout(checkReady, 50);
    };
    checkReady();
  });
}

async function enterYouTubeMode(videoId, startAt = 0) {
  console.log('[YTDBG] enterYouTubeMode called', { videoId, startAt });
  isYouTubeMode = true;
  ytContainer.style.display = 'block';
  myVideo.pause();
  myVideo.style.display = 'none';
  await ensureYouTubeAPI();
  console.log('[YTDBG] ensureYouTubeAPI resolved. Creating/using player...');

  if (!ytPlayer) {
    console.log('[YTDBG] Creating new YT.Player');
    ytPlayer = new YT.Player('ytContainer', {
      width: '100%', height: '100%', videoId,
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1, controls: 0, disablekb: 1, autoplay: 1 },
      events: {
        onReady: () => {
          console.log('[YTDBG] onReady fired');
          videoDuration = ytPlayer.getDuration();
          console.log('[YTDBG] duration', videoDuration);
          if (!ytPollInterval) {
            ytPollInterval = setInterval(() => { scheduleUIUpdate(); }, 200);
          }
          // Start muted to satisfy autoplay policies; user can raise volume
          ytPlayer.mute();
          setVolume(0);
          if (startAt > 0) ytPlayer.seekTo(startAt, true);
          try { ytPlayer.playVideo(); } catch (e) { console.warn('[YTDBG] playVideo threw:', e); }
        },
        onStateChange: (e) => {
          console.log('[YTDBG] onStateChange', e.data, (window.YT && YT.PlayerState) ? Object.keys(YT.PlayerState).find(k => YT.PlayerState[k] === e.data) : '');
          const YTPS = YT.PlayerState;
          if (e.data === YTPS.PLAYING) {
            stopLoadingAnimation();
            playPauseBtn.classList.add('playing');
            endedButtons.style.display = 'none';
          } else if (e.data === YTPS.BUFFERING) {
            startLoadingAnimation();
          } else if (e.data === YTPS.ENDED) {
            endedButtons.style.display = 'flex';
          } else if (e.data === YTPS.PAUSED) {
            playPauseBtn.classList.remove('playing');
          }
          scheduleUIUpdate();
        }
      }
    });
  } else {
    console.log('[YTDBG] Reusing existing player. loadVideoById', { videoId, startAt });
    ytPlayer.loadVideoById({ videoId, startSeconds: startAt });
    ytPlayer.mute();
    setVolume(0);
  }
}