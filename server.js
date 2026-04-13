const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const WIDTH = 120;
const HEIGHT = 80;
const COLORS_COUNT = 16;
const PIXELS_PER_HOUR = 20;

const FILE_PATH = './canvas_state.dat';

// --- ИНИЦИАЛИЗАЦИЯ ДАННЫХ ---
let canvasData; // Просто объявляем

if (fs.existsSync(FILE_PATH)) {
    try {
        canvasData = fs.readFileSync(FILE_PATH);
        // Проверка: если файл битый или размер не совпадает, создаем новый
        if (canvasData.length !== WIDTH * HEIGHT) {
            canvasData = Buffer.alloc(WIDTH * HEIGHT, 0);
        }
        console.log('Поле загружено с диска');
    } catch (e) {
        canvasData = Buffer.alloc(WIDTH * HEIGHT, 0);
    }
} else {
    canvasData = Buffer.alloc(WIDTH * HEIGHT, 0);
    console.log('Создано новое чистое поле');
}

let chatHistory = []; 
let rateLimits = new Map();

// --- СОХРАНЕНИЕ ---
function saveToDisk() {
    try {
        fs.writeFileSync(FILE_PATH, canvasData);
        // Чат сохранять не будем, пусть он вайпается при перезагрузке (для актива)
    } catch (e) {
        console.error('Ошибка сохранения:', e);
    }
}

// Сохраняем раз в минуту, чтобы не нагружать диск
setInterval(saveToDisk, 60000);

// --- ЛОГИКА СОЕДИНЕНИЙ ---
wss.on('connection', (ws, req) => {
    let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (ip.includes('::ffff:')) ip = ip.split(':').pop();
    if (ip === '::1') ip = '127.0.0.1';

    // Отправляем текущее состояние
    ws.send(JSON.stringify({ 
        type: 'init', 
        data: canvasData.toString('base64'),
        chat: chatHistory 
    }));

    ws.on('message', (message) => {
        try {
            const msg = JSON.parse(message);

            if (msg.type === 'pixel') {
                const { x, y, color } = msg;
                if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT || color < 0 || color >= COLORS_COUNT) return;

                const isLocal = ip === '127.0.0.1' || ip === 'localhost';
                if (!isLocal) {
                    const now = Date.now();
                    let limit = rateLimits.get(ip) || { count: 0, resetTime: now + 3600000 };
                    if (now > limit.resetTime) limit = { count: 0, resetTime: now + 3600000 };
                    
                    if (limit.count >= PIXELS_PER_HOUR) {
                        return ws.send(JSON.stringify({ type: 'error', message: '20 пикселей в час!' }));
                    }
                    limit.count++;
                    rateLimits.set(ip, limit);
                }

                canvasData[y * WIDTH + x] = color;
                broadcast({ type: 'update', x, y, color });
            }

            if (msg.type === 'chat') {
                const chatMsg = { 
                    text: msg.text.substring(0, 100).replace(/<[^>]*>/g, ''), 
                    time: new Date().toLocaleTimeString() 
                };
                chatHistory.push(chatMsg);
                if (chatHistory.length > 30) chatHistory.shift();
                broadcast({ type: 'chat', ...chatMsg });
            }
        } catch (e) {}
    });
});

function broadcast(data) {
    const s = JSON.stringify(data);
    wss.clients.forEach(c => { if (c.readyState === 1) c.send(s); });
}

app.use(express.static('public'));
server.listen(3000, () => console.log('Server: http://localhost:3000'));