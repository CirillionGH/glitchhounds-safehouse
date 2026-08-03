// GlitchHounds Safehouse - Complete Unified Stream Overlay (Phaser 3)
// Updated: Replaced static slot indexes with a dynamic anti-stacking wander algorithm. Every time a user sends a message, the overlay calculates a fresh, well-spaced randomized position around the target room's center, ensuring avatars actively step/move to a new location on every message while completely avoiding collisions.

// ==========================================
// GLOBAL WEBSOCKET INITIALIZATION
// ==========================================
const socket = new WebSocket('wss://glitchhounds-safehouse.onrender.com');

socket.onopen = () => {
    console.log('⚡ Overlay connected to GlitchHounds Safehouse!');
};

socket.onclose = () => {
    console.log('🔌 Disconnected from WebSocket server.');
};

socket.onerror = (error) => {
    console.error('❌ WebSocket error:', error);
};

const ROOM_MAP = {
    // 🛋️ LIVING ROOM (Top-Left)
    'yapper-central': { x: 500, y: 260, labelY: 315 },
    'other-gaming': { x: 200, y: 380, labelY: 445 },
    'spam-dump': { x: 880, y: 410, labelY: 485 },
    'tiny-uplifts': { x: 520, y: 90, labelY: 145 },
    'polls': { x: 810, y: 110, labelY: 170 },
    'birthdays': { x: 1120, y: 380, labelY: 435 },
    'social-feed': { x: 200, y: 150, labelY: 205 },

    // 📺 MEDIA & SHOWCASE ROOM (Top-Right)
    'pics-vids': { x: 1440, y: 260, labelY: 320 },
    'pets': { x: 1120, y: 160, labelY: 225 },
    'for-the-foodies': { x: 1750, y: 410, labelY: 470 },
    'music': { x: 1770, y: 230, labelY: 290 },
    'fn-pics-clips-tips': { x: 1440, y: 100, labelY: 160 },
    'self-promo': { x: 1810, y: 120, labelY: 180 },

    // 🎮 GAMING & MINING ZONE (Bottom-Left)
    'map-codes': { x: 210, y: 640, labelY: 705 },
    'offical-fn-status': { x: 680, y: 630, labelY: 690 },
    'current-contest': { x: 830, y: 770, labelY: 830 },
    'heyciri-shop': { x: 850, y: 960, labelY: 1020 },
    'pixel-grove': { x: 120, y: 900, labelY: 960 },
    'mining-cave': { x: 380, y: 880, labelY: 945 },
    'mining-tunnel': { x: 500, y: 950, labelY: 1010 },

    // ☕ LOUNGE & TECH HUB (Bottom-Right)
    'fn-leaks': { x: 1440, y: 720, labelY: 775 },
    'rank': { x: 1140, y: 840, labelY: 900 },
    'tech-support': { x: 1180, y: 680, labelY: 740 },
    'bug-reports': { x: 1780, y: 660, labelY: 725 },

    // Fallback Foyer
    'default': { x: 960, y: 540, labelY: 585 }
};

const CHANNEL_ALIASES = {
    'yapper-channel': 'yapper-central',
    'yappers': 'yapper-central',
    'general-gaming': 'other-gaming',
    'general': 'yapper-central'
};

const userAvatars = {};
const pendingAvatarLoads = {};
const roomOccupants = {}; // Tracks active occupant arrays per room for lighting and spacing
const roomLightingGlows = {};
let overlayLayer = null;

let userZoomLevel = 1.0;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3.0;
let speakerOrderCounter = 1;

const overlayConfig = {
    soundEnabled: true
};

let audioCtx = null;
let safehouseBgImage = null;
let gameSceneRef = null;

function injectViewportStyles() {
    if (typeof document === 'undefined') return;
    const styleId = 'glitchhounds-overlay-styles';
    if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.innerHTML = `
      body, html {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        background-color: #000000;
        overflow: hidden;
      }
      #game-container {
        position: relative;
        width: 100vw;
        height: 100vh;
        background-color: #000000;
        overflow: hidden;
      }
    `;
        document.head.appendChild(style);
    }
}

function setupDomOverlay() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('custom-dom-overlay')) return;
    overlayLayer = document.createElement('div');
    overlayLayer.id = 'custom-dom-overlay';
    overlayLayer.style.position = 'fixed';
    overlayLayer.style.top = '0';
    overlayLayer.style.left = '0';
    overlayLayer.style.width = '100vw';
    overlayLayer.style.height = '100vh';
    overlayLayer.style.pointerEvents = 'none';
    overlayLayer.style.zIndex = '99999';
    document.body.appendChild(overlayLayer);
}

function getAudioContext() {
    if (!audioCtx && typeof window !== 'undefined') {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
            audioCtx = new AudioContext();
        }
    }
    return audioCtx;
}

function playUiSound(type) {
    if (!overlayConfig.soundEnabled) return;
    try {
        const ctx = getAudioContext();
        if (!ctx) return;
        if (ctx.state === 'suspended') {
            ctx.resume().catch(() => { });
        }

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        const now = ctx.currentTime;

        if (type === 'pop') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(400, now);
            osc.frequency.exponentialRampToValueAtTime(800, now + 0.08);
            gain.gain.setValueAtTime(0.08, now);
            gain.gain.linearRampToValueAtTime(0, now + 0.08);
            osc.start(now);
            osc.stop(now + 0.08);
        } else if (type === 'shift') {
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(220, now);
            osc.frequency.exponentialRampToValueAtTime(330, now + 0.12);
            gain.gain.setValueAtTime(0.06, now);
            gain.gain.linearRampToValueAtTime(0, now + 0.12);
            osc.start(now);
            osc.stop(now + 0.12);
        }
    } catch (e) {
        console.warn('⚠️ Audio play warning:', e);
    }
}

injectViewportStyles();

const config = {
    type: Phaser.AUTO,
    parent: 'game-container',
    backgroundColor: '#000000',
    width: 1920,
    height: 1080,
    dom: {
        createContainer: true
    },
    render: {
        antialias: true,
        roundPixels: true
    },
    scale: {
        mode: Phaser.Scale.ENVELOP,
        autoCenter: Phaser.Scale.CENTER_BOTH
    },
    physics: {
        default: 'arcade',
        arcade: { gravity: { y: 0 } }
    },
    scene: {
        preload: preload,
        create: create,
        update: update
    }
};

const game = new Phaser.Game(config);

function preload() {
    this.load.setCORS('anonymous');
    this.load.image('safehouse-bg', 'GlitchHoundsSafehouse.png');
    this.load.image('default-avatar', 'https://labs.phaser.io/assets/sprites/phaser-dude.png');
}

function create() {
    const scene = this;
    gameSceneRef = scene;

    setupDomOverlay();

    safehouseBgImage = this.add.image(960, 540, 'safehouse-bg');
    safehouseBgImage.setDepth(0);

    setupRoomLighting(scene);
    drawPointOfInterestLabels(scene);

    setupCameraControls(scene);
    setupAudioControlWidget();

    scene.input.on('pointerdown', (pointer) => {
        if (pointer.event.target && pointer.event.target.closest('#audio-control-widget')) return;
    });

    socket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'MESSAGE') {
                handleUserMessage(scene, data);
            }
        } catch (err) {
            console.error('Failed to parse incoming WebSocket message:', err);
        }
    };
}

function setupAudioControlWidget() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('audio-control-widget')) return;

    const widget = document.createElement('div');
    widget.id = 'audio-control-widget';

    function updateWidgetStyle() {
        if (overlayConfig.soundEnabled) {
            widget.innerHTML = '🔊 Sound: ON';
            widget.style.background = 'rgba(0, 0, 0, 0.85)';
            widget.style.color = '#00ffcc';
            widget.style.borderColor = '#00ffcc';
        } else {
            widget.innerHTML = '🔇 Sound: OFF';
            widget.style.background = 'rgba(50, 0, 0, 0.85)';
            widget.style.color = '#ff6b6b';
            widget.style.borderColor = '#ff6b6b';
        }
    }

    widget.style.position = 'fixed';
    widget.style.bottom = '15px';
    widget.style.left = '15px';
    widget.style.zIndex = '99999';
    widget.style.padding = '8px 14px';
    widget.style.fontFamily = 'monospace';
    widget.style.fontSize = '13px';
    widget.style.fontWeight = 'bold';
    widget.style.borderRadius = '6px';
    widget.style.border = '2px solid';
    widget.style.cursor = 'pointer';
    widget.style.boxShadow = '0 4px 15px rgba(0,0,0,0.6)';
    widget.style.userSelect = 'none';

    updateWidgetStyle();

    widget.addEventListener('click', () => {
        const ctx = getAudioContext();
        if (ctx && ctx.state === 'suspended') {
            ctx.resume().catch(() => { });
        }

        overlayConfig.soundEnabled = !overlayConfig.soundEnabled;
        updateWidgetStyle();

        if (overlayConfig.soundEnabled) {
            playUiSound('pop');
        }
    });

    document.body.appendChild(widget);
}

function setupRoomLighting(scene) {
    Object.keys(ROOM_MAP).forEach((roomKey) => {
        if (roomKey === 'default') return;
        const room = ROOM_MAP[roomKey];

        const glow = scene.add.circle(room.x, room.y, 70, 0x4deeea, 0.0);
        glow.setBlendMode(Phaser.BlendModes.ADD);
        roomLightingGlows[roomKey] = glow;
    });
}

function updateRoomLightingIntensity(roomKey) {
    const glow = roomLightingGlows[roomKey];
    if (!glow) return;

    const count = roomOccupants[roomKey] ? roomOccupants[roomKey].length : 0;
    const targetAlpha = Math.min(0.35, 0.08 + (count * 0.05));

    glow.setAlpha(targetAlpha);

    if (!glow.tweenActive) {
        glow.tweenActive = true;
        glow.scene.tweens.add({
            targets: glow,
            scale: { from: 1.0, to: 1.25 },
            alpha: { from: targetAlpha, to: targetAlpha * 0.5 },
            duration: 1500,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });
    }
}

function drawPointOfInterestLabels(scene) {
    const labelStyle = {
        font: 'bold 14px monospace',
        fill: '#4deeea',
        backgroundColor: '#000000dd',
        padding: { x: 8, y: 4 },
        resolution: 2
    };

    Object.keys(ROOM_MAP).forEach((channelKey) => {
        if (channelKey === 'default') return;

        const poi = ROOM_MAP[channelKey];
        scene.add.text(poi.x, poi.labelY, `#${channelKey}`, labelStyle).setOrigin(0.5).setDepth(3);
    });
}

function setupCameraControls(scene) {
    const cam = scene.cameras.main;

    scene.input.on('wheel', (pointer, gameObjects, deltaX, deltaY) => {
        if (deltaY > 0) {
            userZoomLevel = Math.max(MIN_ZOOM, userZoomLevel - 0.1);
        } else {
            userZoomLevel = Math.min(MAX_ZOOM, userZoomLevel + 0.1);
        }
        cam.setZoom(userZoomLevel);
    });

    scene.input.on('pointermove', (pointer) => {
        if (pointer.isDown) {
            cam.scrollX -= (pointer.x - pointer.prevPosition.x) / cam.zoom;
            cam.scrollY -= (pointer.y - pointer.prevPosition.y) / cam.zoom;
        }
    });

    scene.input.keyboard.on('keydown', (event) => {
        if (event.key === '+' || event.key === '=') {
            userZoomLevel = Math.min(MAX_ZOOM, userZoomLevel + 0.15);
            cam.setZoom(userZoomLevel);
        } else if (event.key === '-' || event.key === '_') {
            userZoomLevel = Math.max(MIN_ZOOM, userZoomLevel - 0.15);
            cam.setZoom(userZoomLevel);
        } else if (event.key === '0') {
            userZoomLevel = 1.0;
            cam.setZoom(1.0);
            cam.centerOn(960, 540);
        }
    });
}

function handleUserMessage(scene, data) {
    console.log('💬 Incoming WebSocket Message Data:', data);

    const rawChannel = data.channel ? data.channel.toString() : '';
    const cleanChannel = rawChannel.toLowerCase().replace(/[^a-z0-9-]/g, '').trim();

    let matchedKey = CHANNEL_ALIASES[cleanChannel] || Object.keys(ROOM_MAP).find(key => key === cleanChannel);
    if (!matchedKey) {
        matchedKey = Object.keys(ROOM_MAP).find(key => cleanChannel.includes(key) || key.includes(cleanChannel));
    }

    const targetRoom = ROOM_MAP[matchedKey] || ROOM_MAP['default'];
    const itemKey = matchedKey || 'default';

    const userId = data.userId.toString();
    let avatar = userAvatars[userId];

    if (avatar) {
        avatar.setAlpha(1);

        if (data.lottieData) {
            attachLottieBubble(scene, avatar, data.lottieData);
        } else if (data.mediaUrl) {
            attachMediaBubble(scene, avatar, data.mediaUrl);
        } else if (data.content && data.content.trim().length > 0) {
            attachTextBubble(scene, avatar, data.content);
        }

        triggerAvatarGlow(scene, avatar.border);
        resetBubbleTimer(scene, avatar);
        resetInactivityTimer(scene, avatar, userId);
        moveAvatarToRoom(scene, avatar, targetRoom, itemKey, userId);
        return;
    }

    if (pendingAvatarLoads[userId]) return;

    const avatarKey = `avatar-${userId}`;
    const badgeKey = data.badgeUrl ? `badge-${userId}` : null;

    loadUserAssets(scene, userId, data, avatarKey, badgeKey, targetRoom, itemKey);
}

function loadUserAssets(scene, userId, data, avatarKey, badgeKey, targetRoom, itemKey) {
    let needsLoad = false;
    pendingAvatarLoads[userId] = true;

    if (!scene.textures.exists(avatarKey) && data.avatarUrl) {
        scene.load.image(avatarKey, data.avatarUrl);
        needsLoad = true;
    }

    if (badgeKey && !scene.textures.exists(badgeKey) && data.badgeUrl) {
        scene.load.image(badgeKey, data.badgeUrl);
        needsLoad = true;
    }

    if (needsLoad) {
        scene.load.once('complete', () => {
            delete pendingAvatarLoads[userId];
            const finalAvatarTex = scene.textures.exists(avatarKey) ? avatarKey : 'default-avatar';
            const finalBadgeTex = badgeKey && scene.textures.exists(badgeKey) ? badgeKey : null;
            buildAvatarContainer(scene, data, finalAvatarTex, finalBadgeTex, targetRoom, itemKey);
        });
        scene.load.start();
    } else {
        delete pendingAvatarLoads[userId];
        const finalAvatarTex = scene.textures.exists(avatarKey) ? avatarKey : 'default-avatar';
        const finalBadgeTex = badgeKey && scene.textures.exists(badgeKey) ? badgeKey : null;
        buildAvatarContainer(scene, data, finalAvatarTex, finalBadgeTex, targetRoom, itemKey);
    }
}

function buildAvatarContainer(scene, data, textureKey, badgeTextureKey, targetRoom, itemKey) {
    const userId = data.userId.toString();
    const container = scene.add.container(960, 540);

    const visualContainer = scene.add.container(0, 0);
    container.visualContainer = visualContainer;

    const sprite = scene.add.sprite(0, 0, textureKey);
    if (textureKey === 'default-avatar') {
        sprite.setScale(1.5);
    } else {
        sprite.setDisplaySize(48, 48);
    }

    const border = scene.add.rectangle(0, 0, 52, 52).setStrokeStyle(3, 0x00ffcc);
    container.border = border;

    const nameTag = scene.add.text(0, 36, data.user, {
        font: 'bold 13px monospace',
        fill: '#ffffff',
        backgroundColor: '#000000cc',
        padding: { x: 6, y: 3 },
        resolution: 2
    }).setOrigin(0.5, 0);

    visualContainer.add([border, sprite, nameTag]);

    const isMod = data.isMod || data.mod || data.moderator || (Array.isArray(data.badges) && data.badges.includes('moderator')) || (data.badges && data.badges.moderator);
    const isVip = data.isVip || data.vip || (Array.isArray(data.badges) && data.badges.includes('vip')) || (data.badges && data.badges.vip);
    const isSub = data.isSub || data.subscriber || (Array.isArray(data.badges) && data.badges.includes('subscriber')) || (data.badges && data.badges.subscriber);

    if (badgeTextureKey && scene.textures.exists(badgeTextureKey)) {
        const badgeSprite = scene.add.sprite(-32, 0, badgeTextureKey);
        badgeSprite.setDisplaySize(18, 18);
        visualContainer.add(badgeSprite);
    } else if (isMod || isVip || isSub || data.role || data.badgeType) {
        const badgeColor = isMod ? 0x2ecc71 : (isVip ? 0xf1c40f : (isSub ? 0x9b59b6 : 0x4deeea));
        const badgeCircle = scene.add.circle(-32, 0, 8, badgeColor);
        badgeCircle.setStrokeStyle(2, 0x000000);
        visualContainer.add(badgeCircle);
    }

    scene.tweens.add({
        targets: visualContainer,
        y: '-=6',
        duration: 800,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
    });

    container.add(visualContainer);
    userAvatars[userId] = container;

    if (data.lottieData) {
        attachLottieBubble(scene, container, data.lottieData);
    } else if (data.mediaUrl) {
        attachMediaBubble(scene, container, data.mediaUrl);
    } else if (data.content && data.content.trim().length > 0) {
        attachTextBubble(scene, container, data.content);
    }

    triggerAvatarGlow(scene, border);
    resetBubbleTimer(scene, container);
    resetInactivityTimer(scene, container, userId);
    moveAvatarToRoom(scene, container, targetRoom, itemKey, userId);
}

function triggerAvatarGlow(scene, border) {
    if (border) {
        scene.tweens.add({
            targets: border,
            scale: 1.3,
            duration: 1000,
            yoyo: true,
            ease: 'Quad.easeInOut'
        });

        let colorObj = { t: 0 };
        scene.tweens.add({
            targets: colorObj,
            t: 1,
            duration: 2000,
            onUpdate: () => {
                const color = Phaser.Display.Color.HSLToColor(colorObj.t, 1.0, 0.5);
                border.setStrokeStyle(3, color.color);
            },
            onComplete: () => {
                border.setStrokeStyle(3, 0x00ffcc);
            }
        });
    }
}

function attachTextBubble(scene, container, content) {
    clearCurrentBubble(container);
    playUiSound('pop');

    const targetContainer = container.visualContainer || container;

    const bubble = scene.add.text(0, -28, content, {
        font: '13px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", monospace',
        fill: '#000000',
        backgroundColor: '#ffffff',
        padding: { x: 8, y: 5 },
        wordWrap: { width: 180 },
        resolution: 2
    }).setOrigin(0.5, 1);

    targetContainer.add(bubble);
    container.activeBubble = bubble;
}

function attachMediaBubble(scene, container, mediaUrl) {
    clearCurrentBubble(container);
    if (!overlayLayer) setupDomOverlay();
    playUiSound('pop');

    const isVideo = mediaUrl.match(/\.(mp4|webm|mov)(\?.*)?$/i);
    const mediaEl = document.createElement(isVideo ? 'video' : 'img');

    mediaEl.style.width = '120px';
    mediaEl.style.height = '120px';
    mediaEl.style.objectFit = 'cover';
    mediaEl.style.borderRadius = '10px';
    mediaEl.style.border = '2px solid #00ffcc';
    mediaEl.style.boxShadow = '0px 6px 16px rgba(0,0,0,0.7)';
    mediaEl.style.backgroundColor = '#000000dd';
    mediaEl.style.display = 'block';
    mediaEl.style.position = 'fixed';
    mediaEl.style.pointerEvents = 'auto';

    if (isVideo) {
        mediaEl.autoplay = true;
        mediaEl.loop = true;
        mediaEl.muted = true;
        mediaEl.playsInline = true;
        mediaEl.src = mediaUrl;
    } else {
        mediaEl.crossOrigin = 'anonymous';
        mediaEl.src = mediaUrl;
    }

    overlayLayer.appendChild(mediaEl);
    container.domNode = mediaEl;
    container.activeBubble = mediaEl;
}

function attachLottieBubble(scene, container, lottieJsonObject) {
    clearCurrentBubble(container);
    if (!overlayLayer) setupDomOverlay();
    playUiSound('pop');

    const wrapper = document.createElement('div');
    wrapper.style.width = '120px';
    wrapper.style.height = '120px';
    wrapper.style.borderRadius = '10px';
    wrapper.style.border = '2px solid #00ffcc';
    wrapper.style.boxShadow = '0px 6px 16px rgba(0,0,0,0.7)';
    wrapper.style.backgroundColor = '#000000bb';
    wrapper.style.overflow = 'hidden';
    wrapper.style.display = 'block';
    wrapper.style.position = 'fixed';
    wrapper.style.pointerEvents = 'auto';

    if (window.lottie) {
        const anim = window.lottie.loadAnimation({
            container: wrapper,
            renderer: 'svg',
            loop: true,
            autoplay: true,
            animationData: lottieJsonObject
        });

        anim.addEventListener('DOMLoaded', () => {
            const svg = wrapper.querySelector('svg');
            if (svg) {
                svg.style.width = '100%';
                svg.style.height = '100%';
                svg.style.display = 'block';
            }
        });
    }

    overlayLayer.appendChild(wrapper);
    container.domNode = wrapper;
    container.activeBubble = wrapper;
}

function clearCurrentBubble(container) {
    if (container.activeBubble && container.activeBubble instanceof Phaser.GameObjects.Text) {
        container.activeBubble.destroy();
    }
    if (container.domNode && container.domNode.parentNode) {
        container.domNode.parentNode.removeChild(container.domNode);
    }
    container.activeBubble = null;
    container.domNode = null;
}

function resetBubbleTimer(scene, avatar) {
    if (avatar.bubbleTimer) {
        avatar.bubbleTimer.remove();
    }

    avatar.bubbleTimer = scene.time.delayedCall(15000, () => {
        if (avatar.activeBubble) {
            if (avatar.activeBubble instanceof Phaser.GameObjects.Text) {
                scene.tweens.add({
                    targets: avatar.activeBubble,
                    alpha: 0,
                    duration: 500,
                    onComplete: () => {
                        clearCurrentBubble(avatar);
                    }
                });
            } else if (avatar.domNode) {
                scene.tweens.add({
                    targets: { alpha: 1 },
                    alpha: 0,
                    duration: 500,
                    onUpdate: (tween) => {
                        avatar.domNode.style.opacity = tween.getValue();
                    },
                    onComplete: () => {
                        clearCurrentBubble(avatar);
                    }
                });
            }
        }
    });
}

function resetInactivityTimer(scene, avatar, userId) {
    if (avatar.inactivityTimer) {
        avatar.inactivityTimer.remove();
    }
    if (avatar.snoozeTimer) {
        avatar.snoozeTimer.remove();
    }

    avatar.snoozeTimer = scene.time.delayedCall(120000, () => {
        if (avatar && avatar.active) {
            attachTextBubble(scene, avatar, '💤 Zzz');
        }
    });

    avatar.inactivityTimer = scene.time.delayedCall(300000, () => {
        scene.tweens.add({
            targets: avatar,
            alpha: 0,
            duration: 1000,
            onComplete: () => {
                clearCurrentBubble(avatar);
                if (avatar.currentRoomKey && roomOccupants[avatar.currentRoomKey]) {
                    roomOccupants[avatar.currentRoomKey] = roomOccupants[avatar.currentRoomKey].filter(id => id !== userId);
                    updateRoomLightingIntensity(avatar.currentRoomKey);
                }
                avatar.destroy();
                delete userAvatars[userId];
            }
        });
    });
}

function moveAvatarToRoom(scene, avatar, targetRoom, itemKey, userId) {
    // Update room occupancy records
    if (avatar.currentRoomKey && avatar.currentRoomKey !== itemKey) {
        if (roomOccupants[avatar.currentRoomKey]) {
            roomOccupants[avatar.currentRoomKey] = roomOccupants[avatar.currentRoomKey].filter(id => id !== userId);
            updateRoomLightingIntensity(avatar.currentRoomKey);
        }
    }

    avatar.currentRoomKey = itemKey;
    if (!roomOccupants[itemKey]) {
        roomOccupants[itemKey] = [];
    }
    if (!roomOccupants[itemKey].includes(userId)) {
        roomOccupants[itemKey].push(userId);
    }

    // Generate a dynamic, non-overlapping random wander position around the room center 
    // so every single message causes the avatar to step/shift to a fresh location.
    let bestX = targetRoom.x;
    let bestY = targetRoom.y;
    let maxDist = -1;

    const attempts = 8;
    for (let i = 0; i < attempts; i++) {
        const angle = Math.random() * Math.PI * 2;
        const radius = Phaser.Math.Between(30, 95);
        const candidateX = targetRoom.x + Math.cos(angle) * radius;
        const candidateY = targetRoom.y + Math.sin(angle) * radius;

        let minDistanceToOthers = 9999;
        Object.keys(userAvatars).forEach(otherId => {
            if (otherId !== userId) {
                const otherAvatar = userAvatars[otherId];
                if (otherAvatar && otherAvatar.currentRoomKey === itemKey) {
                    const dist = Phaser.Math.Distance.Between(candidateX, candidateY, otherAvatar.x, otherAvatar.y);
                    if (dist < minDistanceToOthers) {
                        minDistanceToOthers = dist;
                    }
                }
            }
        });

        if (minDistanceToOthers > maxDist) {
            maxDist = minDistanceToOthers;
            bestX = candidateX;
            bestY = candidateY;
        }
    }

    // Active speaker foreground tier (20000+)
    avatar.setDepth(20000 + (speakerOrderCounter++));

    playUiSound('shift');
    updateRoomLightingIntensity(itemKey);

    const trailEmitter = scene.add.particles(avatar.x, avatar.y, 'default-avatar', {
        scale: { start: 0.08, end: 0 },
        alpha: { start: 0.5, end: 0 },
        lifespan: 500,
        frequency: 35,
        tint: 0x4deeea
    });
    trailEmitter.setDepth(bestY - 1);

    scene.tweens.add({
        targets: avatar,
        x: bestX,
        y: bestY,
        duration: 1800,
        ease: 'Power2',
        onUpdate: () => {
            trailEmitter.setPosition(avatar.x, avatar.y + 20);
        },
        onComplete: () => {
            trailEmitter.stop();
            scene.time.delayedCall(600, () => {
                trailEmitter.destroy();
            });
        }
    });
}

function update() {
    if (!gameSceneRef || !game.canvas) return;
    const scene = gameSceneRef;
    const cam = scene.cameras.main;

    const rect = game.canvas.getBoundingClientRect();
    const scaleX = rect.width / 1920;
    const scaleY = rect.height / 1080;

    const camCenterX = cam.scrollX + cam.centerX;
    const camCenterY = cam.scrollY + cam.centerY;
    const screenCenterX = rect.left + (rect.width / 2);
    const screenCenterY = rect.top + (rect.height / 2);

    Object.values(userAvatars).forEach(avatar => {
        if (avatar && avatar.domNode) {
            const visualY = avatar.visualContainer ? avatar.visualContainer.y : 0;
            const bubbleAnchorY = avatar.y + visualY - 55;

            const relX = (avatar.x - camCenterX) * cam.zoom;
            const relY = (bubbleAnchorY - camCenterY) * cam.zoom;

            const screenX = screenCenterX + (relX * scaleX);
            const screenY = screenCenterY + (relY * scaleY);

            const node = avatar.domNode;
            node.style.left = `${screenX}px`;
            node.style.top = `${screenY}px`;
            node.style.zIndex = Math.floor(avatar.depth);

            const effectiveScale = cam.zoom * ((scaleX + scaleY) / 2);
            node.style.transform = `translate(-50%, -100%) scale(${effectiveScale})`;
            node.style.transformOrigin = 'bottom center';
            node.style.display = avatar.alpha > 0.05 ? 'block' : 'none';
            node.style.opacity = avatar.alpha;
        }
    });
}