// server.js
require('dotenv').config(); 
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const db = require('./db'); 
const cors = require('cors');

const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs'); 
const swaggerDocument = YAML.load('./swagger.yaml'); 

const authRoutes = require('./routes/auth'); 
const userRoutes = require('./routes/users'); 
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
const reservationRoutes = require('./routes/reservations'); 
const newsRoutes = require('./routes/news'); 
const chatRoutes = require('./routes/chat');   
const paymentWebhookRoutes = require('./routes/payment_webhooks'); 
const fakePaymentRoutes = require('./routes/fake_payment');
const basicAuth = require('express-basic-auth');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});
const port = process.env.PORT || 3000; 




app.use(express.json());

app.use(express.urlencoded({ extended: true }));

app.use(cors());
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
  next(); 
app.use('/api-docs', basicAuth({
    users: { 'admin': '12345' }, 
    challenge: true, 
    realm: 'SwaggerAPIDocs',
}), swaggerUi.serve, swaggerUi.setup(swaggerDocument));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/fake-payment', fakePaymentRoutes); // <-- Подключаем роутер фейковой оплаты

// --- Основные API Маршруты ---
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));
// Приветственный маршрут
app.get('/api', (req, res) => {
  res.json({ message: 'Добро пожаловать в Theatre API!' });
});

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
  next();
});

app.use('/api/auth', authRoutes); 
app.use('/api/users', userRoutes); 
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
app.use('/api/reservations', reservationRoutes);
app.use('/api/news', newsRoutes);
app.use('/api/chat', chatRoutes); 
app.use('/api/payment/webhook', paymentWebhookRoutes); 


const chatHandler = require('./websockets/chatHandler'); 
chatHandler(io); 




app.use((req, res, next) => {
  res.status(404).json({ error: "Маршрут не найден" });
});


app.use((err, req, res, next) => {
  console.error("Произошла необработанная ошибка:", err.stack || err.message || err);
  
  res.status(err.status || 500).json({
      error: err.message || 'Внутренняя ошибка сервера'
      
  });
});



server.listen(port, () => {
  console.log(`Сервер (HTTP + WebSocket) успешно запущен на порту ${port}`);

 
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



const gracefulShutdown = async (signal) => {
  console.log(`\nПолучен сигнал ${signal}. Завершение работы...`);
  try {
   
    await db.pool.end(); 
    console.log('Пул соединений PostgreSQL успешно закрыт.');
    process.exit(0); 
  } catch (err) {
    console.error('Ошибка при закрытии пула соединений:', err);
    process.exit(1); 
  }
};


process.on('SIGINT', gracefulShutdown); 
process.on('SIGTERM', gracefulShutdown); 
