const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Servimos archivos estáticos de la carpeta public
app.use(express.static(path.join(__dirname, 'public')));

// Configuración de la lógica
const FPS = 60;
const TICK_RATE = 1000 / FPS;
const LOGICAL_SIZE = 1000;

let ball = {
    x: LOGICAL_SIZE / 2,
    y: 50,
    vx: 0,
    vy: 0,
    radius: 15
};

let platforms = [];
let score = 0;
let highScore = 0;

// Configuración de jugadores multijugador y cola
const MAX_ACTIVE_PLAYERS = 10;
const INACTIVITY_TIMEOUT = 2 * 60 * 1000; // 2 minutos

let players = {};
let activeCount = 0;
let queue = [];

function resetBall() {
    ball = {
        x: LOGICAL_SIZE / 2,
        y: 50,
        vx: (Math.random() - 0.5) * 6,
        vy: 0,
        radius: 15
    };
    platforms = [];
}

function processQueue() {
    while (activeCount < MAX_ACTIVE_PLAYERS && queue.length > 0) {
        let nextId = queue.shift();
        if (players[nextId]) {
            players[nextId].active = true;
            players[nextId].lastActivity = Date.now();
            activeCount++;
        }
    }
}

io.on('connection', (socket) => {
    // Al conectar, creamos el perfil básico pero desactivado
    players[socket.id] = {
        id: socket.id,
        name: 'Invitado',
        active: false,
        lastActivity: Date.now(),
        color: '#ffffff'
    };

    socket.on('join', (data) => {
        const player = players[socket.id];
        if (!player) return;

        player.name = data.name.substring(0, 12);
        player.color = data.color;

        // Verificamos si entra a jugar o va a la cola
        if (activeCount < MAX_ACTIVE_PLAYERS) {
            player.active = true;
            activeCount++;
        } else {
            queue.push(socket.id);
        }

        socket.emit('init', { id: socket.id });

        // Mensaje de bienvenida
        socket.emit('chatMessage', {
            sender: 'SISTEMA',
            text: `¡Bienvenido ${player.name}! Pulsa T para chatear.`,
            color: '#ffaa00'
        });

        console.log(`[JUEGO] ${player.name} se ha unido.`);
    });

    // Mensaje de bienvenida al chat para verificar que funciona
    socket.emit('chatMessage', {
        sender: 'SISTEMA',
        text: 'Conectado al chat global. Pulsa T para escribir.',
        color: '#ffaa00'
    });
    console.log(`[CHAT] Bienvenido enviado a ${socket.id}`);

    // Cuando un jugador interactúa y pone plataforma
    socket.on('click', (data) => {
        let p = players[socket.id];
        if (p && p.active) {
            p.lastActivity = Date.now();
            platforms.push({
                id: Math.random().toString(36).substr(2, 9),
                x: data.x,
                y: data.y,
                width: 120,
                height: 15,
                createdAt: Date.now(),
                hit: false,
                color: p.color
            });
        }
    });

    // Evento Premium por ver un anuncio Reward (simulado)
    socket.on('skipQueueRequest', () => {
        let index = queue.indexOf(socket.id);
        if (index !== -1) {
            // Elimina al jugador de su actual posición
            queue.splice(index, 1);
            // Lo inserta al inicio de la cola
            queue.unshift(socket.id);
            processQueue();
        }
    });

    // Lógica de Chat con Cooldown y Anti-Spam (Ban 1h)
    socket.on('chatMessage', (msg) => {
        const now = Date.now();
        const player = players[socket.id];
        if (!player) return;

        // 1. Comprobar si está baneado
        if (player.bannedUntil && now < player.bannedUntil) {
            const minutesLeft = Math.ceil((player.bannedUntil - now) / (60 * 1000));
            socket.emit('chatError', `Estás baneado del chat por spam. Te quedan ${minutesLeft} min.`);
            return;
        }

        // 2. Comprobar Cooldown de 30s
        const cooldown = 30 * 1000;
        if (player.lastMessageTime && (now - player.lastMessageTime < cooldown)) {
            const timeLeft = Math.ceil((cooldown - (now - player.lastMessageTime)) / 1000);
            socket.emit('chatError', `Espera ${timeLeft}s para volver a escribir.`);
            return;
        }

        if (!msg || typeof msg !== 'string') return;
        const cleanMsg = msg.trim().substring(0, 100);
        if (cleanMsg.length === 0) return;

        // 3. Detectar Spam de mensaje idéntico (Ban 1 hora)
        if (player.lastMessageContent === cleanMsg) {
            player.bannedUntil = now + (60 * 60 * 1000); // 1 hora
            socket.emit('chatError', '¡BANEADO! No repitas el mismo mensaje. Bloqueado por 1 hora.');
            console.log(`[CHAT] Jugador ${player.name} baneado 1h por spam.`);
            return;
        }

        const urlRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|([a-z0-9]+\.(com|net|org|io|es|gov|edu))/i;
        if (urlRegex.test(cleanMsg)) {
            socket.emit('chatError', '¡No se permiten enlaces!');
            return;
        }

        // 4. Filtro de Insultos Multilingüe
        const badWords = [
            // Español
            'puta', 'puto', 'mierda', 'cabron', 'cabrona', 'gilipollas', 'joputa', 'maricon', 'zorra', 'coño', 'pendejo', 'pendeja', 'boludo', 'culiao',
            // Inglés
            'fuck', 'shit', 'bitch', 'asshole', 'dick', 'pussy', 'cunt', 'faggot', 'nigger', 'bastard', 'motherfucker',
            // Francés
            'merde', 'putain', 'salope', 'connard', 'encule',
            // Italiano
            'cazzo', 'vaffanculo', 'stronzo', 'puttana',
            // Alemán
            'scheisse', 'arschloch', 'fotze', 'wichser'
        ];

        let filteredMsg = cleanMsg;
        badWords.forEach(word => {
            const regex = new RegExp(`\\b${word}\\b`, 'gi');
            filteredMsg = filteredMsg.replace(regex, '*'.repeat(word.length));
        });

        // Marcar estado del mensaje
        player.lastMessageTime = now;
        player.lastMessageContent = cleanMsg;

        const senderLabel = player.name || `Jugador ${socket.id.substring(0, 4)}`;
        const playerColor = player.color || '#66fcf1';

        const packet = {
            sender: senderLabel,
            text: filteredMsg,
            color: playerColor
        };

        io.emit('chatMessage', packet);
        console.log(`[CHAT] Emitido a todos: ${cleanMsg}`);
    });

    socket.on('disconnect', () => {
        if (players[socket.id] && players[socket.id].active) {
            activeCount--;
        } else {
            queue = queue.filter(id => id !== socket.id);
        }
        delete players[socket.id];
        processQueue();
    });
});

function updatePhysics() {
    // Aplicamos gravedad constante
    ball.vy += 0.25;

    ball.x += ball.vx;
    ball.y += ball.vy;

    // Colisión de rebote en los muros laterales
    if (ball.x - ball.radius < 0) {
        ball.x = ball.radius;
        ball.vx *= -1;
    }
    if (ball.x + ball.radius > LOGICAL_SIZE) {
        ball.x = LOGICAL_SIZE - ball.radius;
        ball.vx *= -1;
    }

    // Castigo: Si toca el fondo, mueren. Reiniciamos la puntuación.
    if (ball.y > LOGICAL_SIZE + ball.radius) {
        score = 0;
        resetBall();
    }

    let now = Date.now();
    // Las plataformas existen solo 1 un segundo
    platforms = platforms.filter(p => now - p.createdAt < 1000);

    // Colisiones con plataformas de jugadores
    for (let p of platforms) {
        if (!p.hit && ball.vy > 0 &&
            ball.y + ball.radius >= p.y - p.height / 2 &&
            ball.y - ball.radius <= p.y + p.height / 2 &&
            ball.x + ball.radius >= p.x - p.width / 2 &&
            ball.x - ball.radius <= p.x + p.width / 2) {

            ball.vy = -12; // Impulso vertical por rebote

            // Variación de ángulo horizontal basado en el punto de contacto
            let hitOffset = (ball.x - p.x) / (p.width / 2);
            ball.vx += hitOffset * 4;

            p.hit = true; // Invalida más colisiones en este mismo tick/plataforma
            score++;
            if (score > highScore) highScore = score;

            // Emitimos evento para que los clientes reproduzcan sonido
            io.emit('playSound', p.y);
        }
    }

    // Comprobamos inactividad
    let playersRemoved = false;
    for (let id in players) {
        if (players[id].active && (now - players[id].lastActivity > INACTIVITY_TIMEOUT)) {
            players[id].active = false;
            activeCount--;
            queue.push(id);
            playersRemoved = true;
        }
    }
    if (playersRemoved) processQueue();
}

// Bucle principal de servidor
setInterval(() => {
    updatePhysics();

    let state = {
        ball,
        platforms,
        score,
        highScore,
        activeCount,
        queueLength: queue.length
    };

    io.emit('state', state);         // Broadcast de físicas a todos
    io.emit('queueInfo', queue);     // Lista de queue para actualizar posiciones a los espectadores

}, TICK_RATE);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor de Drop & Bounce ejecutándose en http://localhost:${PORT}`);
});
