// server.js
require('dotenv').config(); // Убедитесь, что dotenv загружает переменные и здесь
const express = require('express');
const db = require('./db'); // Можно импортировать, чтобы убедиться, что подключение инициализируется
const performanceRoutes = require('./routes/performances'); // Импортируем роутер

// TODO: Импортировать другие роутеры по мере их создания

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json()); // Обязательно для парсинга JSON в req.body для POST/PUT запросов
app.use(express.urlencoded({ extended: true })); // Для парсинга форм (если нужно)

// Простой middleware для логирования запросов (полезно для отладки)
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
  next(); // Передаем управление следующему обработчику
});

// --- API Маршруты ---
app.get('/api', (req, res) => {
  res.json({ message: 'Добро пожаловать в Theatre API!' });
});

// Подключаем роутеры для конкретных сущностей
app.use('/api/performances', performanceRoutes);
// TODO: Подключить другие роутеры:
// app.use('/api/actors', actorRoutes);
// app.use('/api/halls', hallRoutes);
// ... и так далее

// Обработка несуществующих маршрутов (должна быть ПОСЛЕ всех app.use для роутеров)
app.use((req, res, next) => {
  res.status(404).json({ error: "Маршрут не найден" });
});

// Глобальный обработчик ошибок (должен быть САМЫМ последним middleware)
app.use((err, req, res, next) => {
  console.error("Произошла необработанная ошибка:", err.stack);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

// Запуск сервера
app.listen(port, () => {
  console.log(`Сервер запущен на порту ${port}`);
  // Можно добавить тестовый запрос к БД при старте
  db.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error("Ошибка подключения к базе данных при старте:", err);
    } else {
        console.log("Успешное тестовое подключение к базе данных:", res.rows[0].now);
    }
  });
});

// Обработка корректного завершения работы (закрытие пула соединений)
process.on('SIGINT', async () => {
    console.log('Получен SIGINT. Завершение работы...');
    await db.pool.end();
    console.log('Пул соединений PostgreSQL закрыт.');
    process.exit(0);
});
process.on('SIGTERM', async () => {
    console.log('Получен SIGTERM. Завершение работы...');
    await db.pool.end();
    console.log('Пул соединений PostgreSQL закрыт.');
    process.exit(0);
});
