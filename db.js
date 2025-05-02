// db.js
require('dotenv').config(); // Загружаем переменные из .env файла в process.env
const { Pool } = require('pg');

// Проверяем, загрузились ли переменные окружения
if (!process.env.DB_USER || !process.env.DB_HOST || !process.env.DB_DATABASE || !process.env.DB_PASSWORD) {
  console.error("Ошибка: Не все переменные окружения для подключения к БД заданы в файле .env!");
  console.error("Убедитесь, что файл .env существует и содержит DB_USER, DB_HOST, DB_DATABASE, DB_PASSWORD, DB_PORT.");
  process.exit(1); // Завершаем работу, если конфигурация неполная
}

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || '5432', 10), // Преобразуем порт в число
  // Можно добавить другие параметры пула, например:
  // max: 20, // Максимальное количество клиентов в пуле
  // idleTimeoutMillis: 30000, // Время простоя клиента перед закрытием (мс)
  // connectionTimeoutMillis: 2000, // Время ожидания соединения (мс)
});

// Обработчик успешного подключения (не обязательно, но полезно для отладки)
pool.on('connect', (client) => {
  console.log('Установлено новое соединение с PostgreSQL');
  // Можно выполнить какой-нибудь начальный запрос, например, установить часовой пояс
  // client.query('SET timezone = "UTC";', (err) => {
  //   if (err) {
  //     console.error('Ошибка установки часового пояса', err.stack);
  //   }
  // });
});

// Обработчик ошибок пула (важно!)
pool.on('error', (err, client) => {
  console.error('Неожиданная ошибка в PostgreSQL пуле соединений', err);
  process.exit(-1); // В продакшене может потребоваться более мягкая перезагрузка
});

console.log(`Настроено подключение к БД: ${process.env.DB_DATABASE} на ${process.env.DB_HOST}:${process.env.DB_PORT} с пользователем ${process.env.DB_USER}`);

// Экспортируем функцию для выполнения запросов
module.exports = {
  query: (text, params) => pool.query(text, params),
  // Экспортируем пул, если нужно будет управлять соединениями вручную (например, для транзакций)
  getClient: () => pool.connect(), // Функция для получения клиента из пула (для транзакций)
  pool: pool // Сам пул (например, для закрытия при завершении работы)
};
