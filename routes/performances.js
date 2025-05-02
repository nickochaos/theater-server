// routes/performances.js
const express = require('express');
const router = express.Router();
const db = require('../db'); // <-- Импортируем наш модуль для работы с БД

// GET /api/performances - Получить список всех представлений
router.get('/', async (req, res) => {
  try {
    // Выполняем SQL-запрос с помощью импортированной функции
    const { rows } = await db.query('SELECT * FROM performances ORDER BY title');
    res.json(rows); // Отправляем результат клиенту
  } catch (err) {
    console.error('Ошибка при получении представлений:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' }); // Отправляем ошибку
  }
});

// GET /api/performances/:id - Получить представление по ID
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // Используем параметризованный запрос для безопасности (защита от SQL-инъекций)
    const { rows } = await db.query('SELECT * FROM performances WHERE id = $1', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Представление не найдено' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(`Ошибка при получении представления ${id}:`, err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// POST /api/performances - Добавить новое представление
router.post('/', async (req, res) => {
  // Получаем данные из тела запроса (убедитесь, что middleware express.json() подключен)
  const { title, type_id, producer_id, description } = req.body;

  // Простая валидация обязательных полей (согласно вашей схеме)
  if (!title || !type_id) {
    return res.status(400).json({ error: 'Необходимо указать название (title) и ID типа (type_id)' });
  }

  try {
    const sql = `
      INSERT INTO performances (title, type_id, producer_id, description)
      VALUES ($1, $2, $3, $4)
      RETURNING *`; // RETURNING * вернет созданную запись
    const values = [title, type_id, producer_id || null, description || null];

    const { rows } = await db.query(sql, values);
    res.status(201).json(rows[0]); // Отправляем созданный объект со статусом 201 Created
  } catch (err) {
    console.error('Ошибка при добавлении представления:', err);
     // Проверка на конкретные ошибки БД, если нужно
     if (err.code === '23503') { // Нарушение внешнего ключа (например, type_id не существует)
        return res.status(400).json({ error: `Неверный ID типа (${type_id}) или продюсера (${producer_id}).` });
     }
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// TODO: Добавить маршруты для PUT (обновление) и DELETE (удаление)

module.exports = router; // Экспортируем роутер
