// El socket se inicializará al pulsar "Unirse"
let socket = null;

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let isQueued = false;
let myId = null;

let displayScale = 1;
let offsetX = 0;
let offsetY = 0;

let audioCtx = null;

// Referencias de elementos de Interfaz
const lobbyOverlay = document.getElementById('lobby-overlay');
const playerNameInput = document.getElementById('player-name');
const joinBtn = document.getElementById('join-btn');
const colorOpts = document.querySelectorAll('.color-opt');
const shareUrlBtn = document.getElementById('share-url-btn');

const currentScoreEl = document.getElementById('current-score');
const highScoreEl = document.getElementById('high-score');
const activePlayersEl = document.getElementById('active-players');
const queuePlayersEl = document.getElementById('queue-players');
const queueOverlay = document.getElementById('queue-overlay');
const queuePositionEl = document.getElementById('queue-position');
const rewardAdBtn = document.getElementById('reward-ad-btn');
const chatInput = document.getElementById('chat-input');
const chatMessages = document.getElementById('chat-messages');
const chatContainer = document.getElementById('chat-container');
const mobileChatBtn = document.getElementById('mobile-chat-btn');

let selectedHue = 180; // Color por defecto

// Selección de color
colorOpts.forEach(opt => {
    opt.addEventListener('click', () => {
        colorOpts.forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        selectedHue = opt.dataset.hue;
    });
});

// Función para iniciar el juego
function joinGame() {
    const name = playerNameInput.value.trim() || 'Jugador';
    const color = `hsl(${selectedHue}, 100%, 65%)`;

    // Ocultamos Lobby
    lobbyOverlay.style.opacity = '0';
    setTimeout(() => lobbyOverlay.classList.add('hidden'), 500);

    // Conectamos Socket
    socket = io(window.location.origin);
    setupSocketEvents();

    // Enviamos datos iniciales tras conectar
    socket.on('connect', () => {
        socket.emit('join', { name, color });
    });
}

joinBtn.addEventListener('click', joinGame);
playerNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinGame();
});

// Copiar URL para compartir
shareUrlBtn.addEventListener('click', () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
        const originalText = shareUrlBtn.innerText;
        shareUrlBtn.innerText = '✅ ¡Copiado!';
        setTimeout(() => shareUrlBtn.innerText = originalText, 2000);
    });
});

function resizeCanvas() {
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;

    // Calculamos la escala para mantener la proporción 1:1 del mundo (1000x1000)
    const scaleX = canvas.width / 1000;
    const scaleY = canvas.height / 1000;
    displayScale = Math.min(scaleX, scaleY);

    // Calculamos el offset para centrar el canvas lógico
    offsetX = (canvas.width - 1000 * displayScale) / 2;
    offsetY = (canvas.height - 1000 * displayScale) / 2;
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas(); // Ajuste inicial

// Manejo de Interacciones del Jugador
function handleInput(e) {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }

    if (isQueued) return; // Si es espectador, ignoramos su input

    let clientX, clientY;

    if (e.type === 'touchstart') {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
    } else {
        clientX = e.clientX;
        clientY = e.clientY;
    }

    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left - offsetX;
    const y = clientY - rect.top - offsetY;

    // Convertimos a coordenadas lógicas
    const logicalX = x / displayScale;
    const logicalY = y / displayScale;

    // Solo enviamos si el clic cae dentro del área lógica
    if (logicalX >= 0 && logicalX <= 1000 && logicalY >= 0 && logicalY <= 1000) {
        socket.emit('click', { x: logicalX, y: logicalY });
    }
}

// Eventos de entrada (Soporte PC y Móvil)
canvas.addEventListener('mousedown', handleInput);
canvas.addEventListener('touchstart', (e) => {
    e.preventDefault(); // Evitamos scroll
    handleInput(e);
}, { passive: false });

function setupSocketEvents() {
    // Recepción del ID inicial
    socket.on('init', (data) => {
        myId = data.id;
    });

    // Reproducir sonido de rebote según la altura (y)
    socket.on('playSound', (y) => {
        if (!audioCtx) return;

        // Calcular la frecuencia según la altura Y.
        // y = 0 (arriba) -> Tono agudo (ej 880Hz)
        // y = 1000 (abajo) -> Tono grave (ej 220Hz)
        const minFreq = 150;
        const maxFreq = 800;
        const percentage = Math.max(0, 1 - (y / 1000)); // 1 arriba, 0 abajo
        const frequency = minFreq + (maxFreq - minFreq) * percentage;

        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        osc.type = 'square'; // Sintetizador retro estilo Arcade
        osc.frequency.setValueAtTime(frequency, audioCtx.currentTime);

        // Envolvente de volumen muy corta y rápida
        gainNode.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);

        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        osc.start();
        osc.stop(audioCtx.currentTime + 0.15);
    });

    // Recepción de la información de la cola (para saber si somos espectadores)
    socket.on('queueInfo', (queueInfo) => {
        const queuePos = queueInfo.indexOf(myId);
        if (queuePos !== -1) {
            isQueued = true;
            queueOverlay.classList.remove('hidden');
            queuePositionEl.innerText = queuePos + 1;
        } else {
            isQueued = false;
            queueOverlay.classList.add('hidden');
        }
        queuePlayersEl.innerText = queueInfo.length;
    });

    let ballTrail = [];
    let currentState = null;

    // Función rápida para el efecto neón simulado sin usar shadowBlur (súper rápido)
    function drawFakeGlowRect(x, y, w, h, color) {
        ctx.fillStyle = color;
        // Núcleo brillante
        ctx.globalAlpha = 1.0;
        ctx.fillRect(x - w / 2, y - h / 2, w, h);
        // Resplandor 1
        ctx.globalAlpha = 0.4;
        ctx.fillRect(x - w / 2 - 4, y - h / 2 - 4, w + 8, h + 8);
        // Resplandor 2
        ctx.globalAlpha = 0.15;
        ctx.fillRect(x - w / 2 - 10, y - h / 2 - 10, w + 20, h + 20);
        
        ctx.globalAlpha = 1.0; // Reset
    }

    function drawFakeGlowCircle(x, y, radius, color) {
        ctx.fillStyle = color;
        // Núcleo
        ctx.globalAlpha = 1.0;
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
        // Resplandor 1
        ctx.globalAlpha = 0.4;
        ctx.beginPath(); ctx.arc(x, y, radius * 1.5, 0, Math.PI * 2); ctx.fill();
        // Resplandor 2
        ctx.globalAlpha = 0.15;
        ctx.beginPath(); ctx.arc(x, y, radius * 2.5, 0, Math.PI * 2); ctx.fill();
        
        ctx.globalAlpha = 1.0; // Reset
    }

    // Recepción del estado a 60 FPS desde el servidor (Solo lógica, NO dibujado)
    socket.on('state', (state) => {
        currentState = state;

        // 1. Actualizar textos de UI solo si cambian (ahorra repintado en el DOM)
        if (currentScoreEl.innerText != state.score) currentScoreEl.innerText = state.score;
        let hsText = 'Record: ' + state.highScore;
        if (highScoreEl.innerText != hsText) highScoreEl.innerText = hsText;
        if (activePlayersEl.innerText != state.activeCount) activePlayersEl.innerText = state.activeCount;

        // Guardar posiciones del rastro lógicamente
        ballTrail.push({ x: state.ball.x, y: state.ball.y });
        if (ballTrail.length > 10) ballTrail.shift();
    });

    // Bucle de renderizado desacoplado y optimizado
    function render() {
        if (!currentState) {
            requestAnimationFrame(render);
            return;
        }

        const state = currentState;

        // Limpiar Frame (usando fillRect con un color sólido en vez de clearRect puede veces ser más rápido, pero clearRect está bien)
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Dibujar Rastro
        ballTrail.forEach((pos, index) => {
            const alpha = (index + 1) / ballTrail.length;
            ctx.fillStyle = `rgba(255, 0, 85, ${alpha * 0.3})`;
            const bx = offsetX + pos.x * displayScale;
            const by = offsetY + pos.y * displayScale;
            const r = state.ball.radius * displayScale * (0.5 + alpha * 0.5);
            ctx.beginPath();
            ctx.arc(bx, by, r, 0, Math.PI * 2);
            ctx.fill();
        });

        // Opcional: dibujar bordes del área del juego (sencillo, sin efectos)
        ctx.strokeStyle = 'rgba(102, 252, 241, 0.1)';
        ctx.lineWidth = 2;
        ctx.strokeRect(offsetX, offsetY, 1000 * displayScale, 1000 * displayScale);

        // Dibujar Plataformas optimizadas
        for (let platform of state.platforms) {
            const color = platform.hit ? '#ffffff' : (platform.color || '#66fcf1');
            const px = offsetX + platform.x * displayScale;
            const py = offsetY + platform.y * displayScale;
            const pWidth = platform.width * displayScale;
            const pHeight = platform.height * displayScale;

            drawFakeGlowRect(px, py, pWidth, pHeight, color);
        }

        // Dibujar Bola Principal optimizada
        const bx = offsetX + state.ball.x * displayScale;
        const by = offsetY + state.ball.y * displayScale;
        const actualRadius = state.ball.radius * displayScale;

        drawFakeGlowCircle(bx, by, actualRadius, '#ff0055');

        requestAnimationFrame(render);
    }
    
    // Iniciar el bucle de renderizado
    requestAnimationFrame(render);


    // ------------------------------------------------------------------
    // LÓGICA DE CHAT
    // ------------------------------------------------------------------

    function toggleChat() {
        chatContainer.classList.toggle('minimized');
        if (!chatContainer.classList.contains('minimized')) {
            chatInput.focus();
        } else {
            chatInput.blur();
        }
    }

    // Abrir con T
    window.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() === 't' && document.activeElement !== chatInput) {
            e.preventDefault();
            toggleChat();
        }
        // Cerrar con Escape
        if (e.key === 'Escape' && !chatContainer.classList.contains('minimized')) {
            toggleChat();
        }
    });

    // Botón móvil
    mobileChatBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleChat();
    });

    function addChatMessage(sender, text, color, isError = false) {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'chat-msg';
        if (isError) msgDiv.style.color = '#ff0055';

        if (sender) {
            const senderSpan = document.createElement('span');
            senderSpan.className = 'sender';
            senderSpan.style.color = color;
            senderSpan.innerText = sender + ':';
            msgDiv.appendChild(senderSpan);
        }

        const textSpan = document.createElement('span');
        textSpan.innerText = text;
        msgDiv.appendChild(textSpan);

        chatMessages.appendChild(msgDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const msg = chatInput.value.trim();
            if (msg) {
                console.log(`[CHAT] Intentando enviar: ${msg}`);
                // Validación básica de links en cliente
                const urlRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|([a-z0-9]+\.(com|net|org|io|es|gov|edu))/i;
                if (urlRegex.test(msg)) {
                    addChatMessage(null, 'No puedes enviar enlaces.', '#ff0055', true);
                } else {
                    socket.emit('chatMessage', msg);
                }
                chatInput.value = '';
                // Eliminamos el toggleChat automático para probar
            }
        }
        // Evitar que las teclas que uses para el juego (como flechas) afecten al juego si el chat está abierto
        e.stopPropagation();
    });

    socket.on('chatMessage', (data) => {
        console.log('[CHAT] Mensaje recibido del servidor:', data);
        addChatMessage(data.sender, data.text, data.color);
    });

    socket.on('chatError', (error) => {
        console.warn('[CHAT] Error recibido:', error);
        addChatMessage(null, error, '#ff0055', true);
    });
}

// ------------------------------------------------------------------
// LÓGICA DE MONETIZACIÓN (REWARD AD PARA SALTAR LA COLA)
// ------------------------------------------------------------------
rewardAdBtn.addEventListener('click', () => {
    // Simulación funcional para la prueba de concepto:
    alert('Simulación: Viendo un anuncio de 15 segundos... ¡Recompensa recibida!');
    if (socket) socket.emit('skipQueueRequest');
});
