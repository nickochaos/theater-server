// routes/orders.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/orders - Получить заказы (нужна фильтрация/пагинация)
// Пример: GET /api/orders?user_id=1
router.get('/', async (req, res) => {
  const { user_id, status } = req.query;
  let sql = `
    SELECT o.id, o.order_date, o.status, o.user_id, u.username
    FROM orders o
    LEFT JOIN users u ON o.user_id = u.id
    `;
  const params = [];
  const conditions = [];

  if (user_id) {
    params.push(user_id);
    conditions.push(`o.user_id = $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`o.status = $${params.length}`);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }
  sql += ' ORDER BY o.order_date DESC'; // Сначала новые

  try {
    const { rows } = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('Ошибка при получении заказов:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// GET /api/orders/:id - Получить заказ по ID
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // Получаем сам заказ
    const orderRes = await db.query(`
        SELECT o.id, o.order_date, o.status, o.user_id, u.username
        FROM orders o
        LEFT JOIN users u ON o.user_id = u.id
        WHERE o.id = $1
    `, [id]);

    if (orderRes.rows.length === 0) {
      return res.status(404).json({ error: 'Заказ не найден' });
    }

    // Получаем связанные бронирования/билеты (пример)
    const bookingsRes = await db.query(`
        SELECT b.id as booking_id, b.ticket_id, t.final_price,
               s.seat_number, r.row_name, z.zone_name, h.hall_name,
               sch.start_date, sch.start_time, p.title as performance_title
        FROM bookings b
        JOIN tickets t ON b.ticket_id = t.id
        JOIN seats s ON t.seat_id = s.id
        JOIN rows r ON s.row_id = r.id
        JOIN zones z ON s.zone_id = z.id
        JOIN halls h ON s.hall_id = h.id
        JOIN schedule sch ON b.schedule_id = sch.id
        JOIN performances p ON sch.performance_id = p.id
        WHERE b.order_id = $1
    `, [id]);

    const orderData = orderRes.rows[0];
    orderData.bookings = bookingsRes.rows; // Добавляем детали бронирования

    res.json(orderData);
  } catch (err) {
    console.error(`Ошибка при получении заказа ${id}:`, err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// POST /api/orders - Создать новый заказ (упрощенный)
// Реальное создание заказа сложнее, см. ниже
router.post('/', async (req, res) => {
  const { user_id } = req.body; // Статус и дата обычно по умолчанию
  if (!user_id) {
    return res.status(400).json({ error: 'Требуется ID пользователя (user_id)' });
  }
  try {
    // В реальном приложении здесь была бы сложная логика с созданием билетов и бронирований в транзакции
    const sql = 'INSERT INTO orders (user_id) VALUES ($1) RETURNING *';
    const { rows } = await db.query(sql, [user_id]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Ошибка при создании заказа:', err);
     if (err.code === '23503') {
       return res.status(400).json({ error: 'Указанный пользователь не существует.' });
     }
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// PUT /api/orders/:id - Обновить статус заказа
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body; // Обновляем только статус
  if (!status) {
     return res.status(400).json({ error: 'Требуется новый статус заказа (status)' });
  }
  // TODO: Добавить валидацию возможных статусов ('pending', 'paid', 'cancelled', etc.)
  try {
    const sql = 'UPDATE orders SET status = $1 WHERE id = $2 RETURNING *';
    const { rows, rowCount } = await db.query(sql, [status, id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Заказ не найден для обновления' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(`Ошибка при обновлении заказа ${id}:`, err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// DELETE /api/orders/:id - Удалить заказ (ОСТОРОЖНО!)
// Обычно заказы не удаляют, а отменяют (меняют статус)
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // Учитывайте ON DELETE CASCADE/RESTRICT в bookings, sales
    // Удаление заказа - деструктивное действие!
    const { rowCount } = await db.query('DELETE FROM orders WHERE id = $1', [id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Заказ не найден для удаления' });
    }
    res.status(204).send(); // No Content
  } catch (err) {
    console.error(`Ошибка при удалении заказа ${id}:`, err);
     if (err.code === '23503') {
        return res.status(409).json({ error: 'Невозможно удалить заказ, так как с ним связаны бронирования или продажи.' });
    }
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

module.exports = router;
