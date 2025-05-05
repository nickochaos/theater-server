// routes/rows.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { protect, isAdmin } = require('../middleware/authMiddleware');

// GET /api/rows - Получить все ряды (Доступно всем авторизованным или вообще всем)
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM rows ORDER BY id');
    res.json(rows);
  } catch (err) {
    console.error('Ошибка при получении рядов:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// GET /api/rows/:id - Получить ряд по ID (Доступно всем авторизованным или вообще всем)
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query('SELECT * FROM rows WHERE id = $1', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Ряд не найден' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(`Ошибка при получении ряда ${id}:`, err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// POST /api/rows - Добавить новый ряд (Только Админ)
router.post('/', protect, isAdmin, async (req, res) => {
  // ИСПРАВЛЕНО: Добавляем hall_id в деструктуризацию
  const { row_name, price_multiplier, hall_id } = req.body;

  // ИСПРАВЛЕНО: Добавляем проверку наличия hall_id
  // Проверяем, что hall_id не undefined и не null, и является числом
   if (!row_name || price_multiplier === undefined || hall_id === undefined || hall_id === null || typeof hall_id !== 'number') {
    return res.status(400).json({ error: 'Требуется название ряда (row_name), множитель цены (price_multiplier) и ID зала (hall_id).' });
  }

  const parsedPriceMultiplier = parseFloat(price_multiplier);
  if (isNaN(parsedPriceMultiplier)) { // Проверяем, является ли результатом число после парсинга
     // В этом случае price_multiplier пришел не как число и не как строка, которую можно распарсить.
     return res.status(400).json({ error: 'Множитель цены (price_multiplier) должен быть числом или строкой, представляющей число.' });
  }

  // Дополнительно: проверка, что hall_id является целым числом, если это критично в схеме БД.
  if (!Number.isInteger(hall_id)) {
       return res.status(400).json({ error: 'ID зала (hall_id) должен быть целым числом.' });
  }

  try {
    // ИСПРАВЛЕНО: Добавляем hall_id в SQL запрос и параметры
    const sql = 'INSERT INTO rows (row_name, price_multiplier, hall_id) VALUES ($1, $2, $3) RETURNING *';
    // Используем parsedPriceMultiplier (число) и hall_id (число)
    const { rows } = await db.query(sql, [row_name, parsedPriceMultiplier, hall_id]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Ошибка при добавлении ряда:', err);
     if (err.code === '23503') { // Foreign key violation
       // Если есть внешний ключ с hall_id в таблице rows и hall_id не существует в таблице halls
       return res.status(400).json({ error: 'Указанный зал (hall_id) не существует.' });
     }
     if (err.code === '23505') { // unique constraint violation
       // Если есть уникальный индекс на (hall_id, row_name) или только на row_name
        return res.status(409).json({ error: 'Ряд с таким названием уже существует в этом зале.' });
     }
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// PUT /api/rows/:id - Обновить ряд (Только Админ)
router.put('/:id', protect, isAdmin, async (req, res) => {
  const { id } = req.params;
  // При PUT, hall_id не должен меняться, поэтому не читаем его из req.body
  const { row_name, price_multiplier } = req.body;

   if (!row_name || price_multiplier === undefined) {
    return res.status(400).json({ error: 'Требуется название ряда (row_name) и множитель цены (price_multiplier)' });
  }

  // КЛИЕНТ ПРИСЫЛАЕТ price_multiplier КАК СТРОКУ ("1.20").
  // БЭКЕНД ДОЛЖЕН ЕЕ РАСПАРСИТЬ В ЧИСЛО.
  const parsedPriceMultiplier = parseFloat(price_multiplier);
   if (isNaN(parsedPriceMultiplier)) {
     return res.status(400).json({ error: 'Множитель цены (price_multiplier) должен быть числом или строкой, представляющей число.' });
  }

  try {
    // ИСПРАВЛЕНО: При PUT обновляем только row_name и price_multiplier по ID
    const sql = 'UPDATE rows SET row_name = $1, price_multiplier = $2 WHERE id = $3 RETURNING *';
    const { rows, rowCount } = await db.query(sql, [row_name, parsedPriceMultiplier, id]); // Используем parsedPriceMultiplier
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Ряд не найден для обновления' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(`Ошибка при обновлении ряда ${id}:`, err);
     if (err.code === '23505') {
       // Если есть уникальный индекс на (hall_id, row_name)
        return res.status(409).json({ error: 'Ряд с таким названием уже существует в этом зале.' });
     }
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// DELETE /api/rows/:id - Удалить ряд (Только Админ)
router.delete('/:id', protect, isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount } = await db.query('DELETE FROM rows WHERE id = $1', [id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Ряд не найден для удаления' });
    }
    res.status(204).send(); // 204 No Content обычно используется для успешного DELETE
  } catch (err) {
    console.error(`Ошибка при удалении ряда ${id}:`, err);
     if (err.code === '23503') { // Foreign key violation
        // Если есть места, ссылающиеся на этот ряд, и ON DELETE RESTRICT
        return res.status(409).json({ error: 'Невозможно удалить ряд, так как он используется в местах. Сначала удалите все места в этом ряду.' });
    }
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

module.exports = router;
