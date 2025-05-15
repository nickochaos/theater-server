// db.js
require('dotenv').config(); 
const { Pool } = require('pg');


if (!process.env.DB_USER || !process.env.DB_HOST || !process.env.DB_DATABASE || !process.env.DB_PASSWORD) {
  console.error("Ошибка: Не все переменные окружения для подключения к БД заданы в файле .env!");
  console.error("Убедитесь, что файл .env существует и содержит DB_USER, DB_HOST, DB_DATABASE, DB_PASSWORD, DB_PORT.");
  process.exit(1); 
}

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || '5432', 10),
 
});


pool.on('connect', (client) => {
  console.log('Установлено новое соединение с PostgreSQL');
});


pool.on('error', (err, client) => {
  console.error('Неожиданная ошибка в PostgreSQL пуле соединений', err);
  process.exit(-1);
});

console.log(`Настроено подключение к БД: ${process.env.DB_DATABASE} на ${process.env.DB_HOST}:${process.env.DB_PORT} с пользователем ${process.env.DB_USER}`);


module.exports = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(), 
  pool: pool 
};
