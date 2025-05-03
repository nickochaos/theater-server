// server.js
require('dotenv').config(); // Загружаем переменные окружения из .env
const express = require('express');
const db = require('./db'); // Наш модуль для работы с БД (инициализирует пул)
const cors = require('cors');

// --- Импорт роутеров ---
const authRoutes = require('./routes/auth'); // Для /register и /login
const userRoutes = require('./routes/users'); // Для управления пользователями (защищенные)
const performanceRoutes = require('./routes/performances');
const actorRoutes = require('./routes/actors');
const producerRoutes = require('./routes/producers');
const performanceTypeRoutes = require('./routes/performance_types');
const performanceRoleTypeRoutes = require('./routes/performance_role_types');
const performanceRoleRoutes = require('./routes/performance_roles');
const hallRoutes = require('./routes/halls');
const zoneRoutes = require('./routes/zones');
const rowRoutes = require('./routes/rows');
const seatRoutes = require('./routes/seats');
const scheduleRoutes = require('./routes/schedule');
const orderRoutes = require('./routes/orders');
const ticketRoutes = require('./routes/tickets');
const bookingRoutes = require('./routes/bookings');
const saleRoutes = require('./routes/sales');
const reservationRoutes = require('./routes/reservations'); // Импорт нового роутера


const app = express();
const port = process.env.PORT || 3000; // Используем порт из .env или 3000

// --- Middleware ---

// Парсинг JSON тел запросов
app.use(express.json());
// Парсинг URL-encoded тел запросов (для обычных HTML форм)
app.use(express.urlencoded({ extended: true }));
// Самый простой вариант, разрешает все источники:
app.use(cors());

// Простое логирование каждого запроса
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
  next(); // Передаем управление дальше
});


// --- Основные API Маршруты ---

// Приветственный маршрут
app.get('/api', (req, res) => {
  res.json({ message: 'Добро пожаловать в Theatre API!' });
});

// --- Подключение роутеров для каждой сущности ---
app.use('/api/auth', authRoutes); // Регистрация и вход (незащищенные)
app.use('/api/users', userRoutes); // Управление пользователями (защищенные внутри роутера)
app.use('/api/performances', performanceRoutes);
app.use('/api/actors', actorRoutes);
app.use('/api/producers', producerRoutes);
app.use('/api/performance-types', performanceTypeRoutes);
app.use('/api/performance-role-types', performanceRoleTypeRoutes);
app.use('/api/performance-roles', performanceRoleRoutes);
app.use('/api/halls', hallRoutes);
app.use('/api/zones', zoneRoutes);
app.use('/api/rows', rowRoutes);
app.use('/api/seats', seatRoutes);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/sales', saleRoutes);
app.use('/api/reservations', reservationRoutes);


// --- Обработчики ошибок (должны идти после всех маршрутов) ---

// Обработка несуществующих маршрутов (404)
app.use((req, res, next) => {
  res.status(404).json({ error: "Маршрут не найден" });
});

// Глобальный обработчик ошибок сервера (500)
// Express автоматически передает сюда ошибки, если вызвать next(err) в роутерах
// Или если произошла синхронная ошибка в middleware/роутере
app.use((err, req, res, next) => {
  console.error("Произошла необработанная ошибка:", err.stack || err.message || err);
  // В продакшене можно не отправлять stack trace клиенту
  res.status(err.status || 500).json({
      error: err.message || 'Внутренняя ошибка сервера'
      // stack: process.env.NODE_ENV === 'development' ? err.stack : undefined // Показывать stack trace только в разработке
  });
});


// --- Запуск сервера ---
app.listen(port, () => {
  console.log(`Сервер успешно запущен на порту ${port}`);

  // Простой тест соединения с БД при старте
  db.query('SELECT NOW()', (err, result) => {
    if (err) {
        console.error("!!! Ошибка подключения к базе данных при старте:", err.message);
    } else if (result && result.rows.length > 0) {
        console.log("Успешное тестовое подключение к базе данных. Текущее время БД:", result.rows[0].now);
    } else {
        console.warn("Тестовое подключение к БД прошло без ошибок, но не вернуло результат.");
    }
  });
});


// --- Обработка корректного завершения работы ---
const gracefulShutdown = async (signal) => {
  console.log(`\nПолучен сигнал ${signal}. Завершение работы...`);
  try {
    // Здесь можно добавить закрытие других ресурсов, если они есть
    await db.pool.end(); // Закрываем пул соединений PostgreSQL
    console.log('Пул соединений PostgreSQL успешно закрыт.');
    process.exit(0); // Выходим с кодом успеха
  } catch (err) {
    console.error('Ошибка при закрытии пула соединений:', err);
    process.exit(1); // Выходим с кодом ошибки
  }
};

// Слушаем сигналы завершения
process.on('SIGINT', gracefulShutdown); // Ctrl+C
process.on('SIGTERM', gracefulShutdown); // Сигнал от системы (например, от pm2 stop)
