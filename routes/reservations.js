// routes/reservations.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { protect, isAdmin } = require('../middleware/authMiddleware');

// Защищаем все маршруты в этом роутере, так как они только для админов
// router.use(protect, isAdmin); // Можно применить ко всему роутеру, если все маршруты админские

// GET /api/reservations - Получить резервации (админские блокировки)
// Добавлена фильтрация по schedule_id и seat_id
// Требует авторизации админа, чтобы получать список всех резерваций
router.get('/', protect, isAdmin, async (req, res) => {
    const { schedule_id, seat_id } = req.query; // Получаем параметры фильтрации из query string
    let sql = 'SELECT * FROM seat_reservations'; // Запрос для получения всех резерваций
    const params = []; // Массив для параметров SQL запроса
    const conditions = []; // Массив для условий WHERE

    // Добавляем условие фильтрации по schedule_id, если параметр передан
    if (schedule_id) {
        // Проверяем, что schedule_id является числом для безопасности
        if (!/^\d+$/.test(schedule_id)) {
            return res.status(400).json({ error: 'Неверный формат schedule_id' });
        }
        params.push(schedule_id); // Добавляем значение в параметры
        conditions.push(`schedule_id = $${params.length}`); // Добавляем условие WHERE, используя плейсхолдер ($1, $2, ...)
    }

     // Добавляем условие фильтрации по seat_id, если параметр передан (опционально)
     if (seat_id) {
        // Проверяем, что seat_id является числом для безопасности
        if (!/^\d+$/.test(seat_id)) {
            return res.status(400).json({ error: 'Неверный формат seat_id' });
        }
        params.push(seat_id);
        conditions.push(`seat_id = $${params.length}`);
    }


    // Если есть условия фильтрации, добавляем WHERE clause к SQL запросу
    if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND '); // Объединяем условия через AND
    }

    // Добавляем сортировку (например, по ID или по комбинации ряда/места для удобства)
    sql += ' ORDER BY id'; // Можно изменить на 'ORDER BY schedule_id, seat_id' или JOINить seats и сортировать по row_id, seat_number

    try {
        const { rows } = await db.query(sql, params); // Выполняем запрос к базе данных
        res.json(rows); // Отправляем результат в формате JSON
    } catch (err) {
        console.error('Ошибка при получении резерваций:', err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' }); // Обработка ошибок сервера
    }
});


// POST /api/reservations - Заблокировать место для сеанса (только админ)
router.post('/', protect, isAdmin, async (req, res) => {
    const { seat_id, schedule_id, reservation_type, notes } = req.body;
    const adminUserId = req.user.id; // ID админа из токена

    if (!seat_id || !schedule_id) {
        return res.status(400).json({ error: 'Требуются seat_id и schedule_id' });
    }

    // TODO: Добавить проверку, что место не занято в bookings для этого schedule_id
    // Это можно сделать отдельным запросом перед INSERT
    // Пример (псевдокод):
    /*
    const bookingCheck = await db.query(
        'SELECT COUNT(*) FROM bookings b JOIN tickets t ON b.ticket_id = t.id WHERE b.schedule_id = $1 AND t.seat_id = $2',
        [schedule_id, seat_id]
    );
    if (bookingCheck.rows[0].count > 0) {
        return res.status(409).json({ error: 'Это место уже забронировано или продано для данного сеанса.' });
    }
    */


    try {
        const sql = `
            INSERT INTO seat_reservations (seat_id, schedule_id, reservation_type, notes, user_id)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *`;
        const { rows } = await db.query(sql, [
            seat_id,
            schedule_id,
            reservation_type || 'blocked_by_admin', // Тип по умолчанию
            notes || null,
            adminUserId // Используем ID админа из токена
        ]);
        res.status(201).json(rows[0]); // Возвращаем созданную запись
    } catch (err) {
        console.error('Ошибка при блокировке места:', err);
         // Обработка ошибки уникального ограничения (место уже заблокировано админом)
        if (err.code === '23505') {
             return res.status(409).json({ error: 'Это место уже заблокировано администратором для данного сеанса.' });
        }
        if (err.code === '23503') { // FK violation
             return res.status(400).json({ error: 'Указанное место или сеанс не существуют.' });
        }
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});


// DELETE /api/reservations/:id - Удалить резервацию по ID (Только Админ)
// Этот маршрут менее удобен из UI блокировки мест, так как вам придется сначала получить ID резервации
router.delete('/:id', protect, isAdmin, async (req, res) => {
    const { id } = req.params; // Получаем ID резервации из параметров URL
    try {
        const { rowCount } = await db.query('DELETE FROM seat_reservations WHERE id = $1', [id]);
        if (rowCount === 0) {
            // Если запись не найдена, возвращаем 404
            return res.status(404).json({ error: 'Блокировка/резервация не найдена' });
        }
        // При успешном удалении возвращаем 204 No Content
        res.status(204).send();
    } catch (err) {
        console.error(`Ошибка при снятии блокировки ${id}:`, err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Альтернативный DELETE по seat_id и schedule_id (может быть удобнее для UI)
// DELETE /api/reservations?seat_id=X&schedule_id=Y
// Этот маршрут удобнее из UI блокировки, так как вы знаете seat_id и schedule_id выбранного места
router.delete('/', protect, isAdmin, async (req, res) => {
    const { seat_id, schedule_id } = req.query; // Получаем параметры из query string
    if (!seat_id || !schedule_id) {
         return res.status(400).json({ error: 'Требуются параметры seat_id и schedule_id' });
    }
    try {
        // Удаляем запись по seat_id и schedule_id
        const { rowCount } = await db.query(
            'DELETE FROM seat_reservations WHERE seat_id = $1 AND schedule_id = $2',
            [seat_id, schedule_id]
        );
        if (rowCount === 0) {
            // Если записи не было, это не ошибка с точки зрения снятия блокировки.
            // Можно вернуть 204 (No Content) или 404 (Not Found), в зависимости от желаемого поведения.
            // 204 более соответствует идемпотентности (повторный запрос не меняет результат).
            return res.status(204).send();
            // Или если считаем, что блокировка обязательно должна была быть:
            // return res.status(404).json({ error: 'Блокировка/резервация для этого места и сеанса не найдена' });
        }
         // При успешном удалении возвращаем 204 No Content
        res.status(204).send();
    } catch (err) {
        console.error(`Ошибка при снятии блокировки места ${seat_id} для сеанса ${schedule_id}:`, err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});


// Экспортируем роутер
module.exports = router;
