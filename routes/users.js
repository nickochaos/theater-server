// routes/users.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { protect, isAdmin } = require('../middleware/authMiddleware'); // Импортируем middleware

// Применяем middleware 'protect' ко всем маршрутам в этом файле
// Любой запрос к /api/users/* теперь требует валидный JWT
router.use(protect);

// GET /api/users - Получить список всех пользователей (только админ)
router.get('/', isAdmin, async (req, res) => { // Добавляем isAdmin middleware
  try {
    // Пароль хеш не выбираем
    const { rows } = await db.query('SELECT id, username, name, surname, email, phone, role FROM users ORDER BY username');
    res.json(rows);
  } catch (err) {
    console.error('Ошибка при получении пользователей (admin):', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// GET /api/users/me - Получить профиль текущего пользователя
router.get('/me', async (req, res) => {
    // Данные пользователя уже есть в req.user из middleware 'protect'
    // Просто возвращаем их (убедившись, что там нет хеша пароля)
    if (req.user) {
        // Убедимся на всякий случай, что хеша точно нет
        const { password_hash, ...userProfile } = req.user;
        res.json(userProfile);
    } else {
        // Эта ситуация не должна произойти, если protect работает правильно
        res.status(404).json({ error: 'Профиль пользователя не найден' });
    }
});


// GET /api/users/:id - Получить пользователя по ID (админ или сам пользователь)
router.get('/:id', async (req, res) => {
  const requestedUserId = parseInt(req.params.id, 10);
  const loggedInUserId = req.user.id;
  const loggedInUserRole = req.user.role;

  // Проверка прав: админ может смотреть всех, пользователь - только себя
  if (loggedInUserRole !== 'admin' && loggedInUserId !== requestedUserId) {
      return res.status(403).json({ error: 'Доступ запрещен' });
  }

  try {
    // Пароль хеш не выбираем
    const { rows } = await db.query('SELECT id, username, name, surname, email, phone, role FROM users WHERE id = $1', [requestedUserId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(`Ошибка при получении пользователя ${requestedUserId}:`, err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});


// PUT /api/users/:id - Обновить профиль (админ или сам пользователь)
// Не обновляет пароль и не позволяет пользователю повысить себе роль
router.put('/:id', async (req, res) => {
    const requestedUserId = parseInt(req.params.id, 10);
    const loggedInUserId = req.user.id;
    const loggedInUserRole = req.user.role;

    // Проверка прав: админ может менять всех, пользователь - только себя
    if (loggedInUserRole !== 'admin' && loggedInUserId !== requestedUserId) {
        return res.status(403).json({ error: 'Доступ запрещен' });
    }

    // Получаем данные для обновления
    // Исключаем поля, которые нельзя менять напрямую (username, password_hash)
    const { name, surname, email, phone, role } = req.body;

    // Валидация
    if (!name || !surname || !email) {
        return res.status(400).json({ error: 'Требуются name, surname, email' });
    }

    // Проверка смены роли: только админ может менять роль, и он не может понизить себя
    let finalRole = req.user.role; // По умолчанию роль не меняется
    if (loggedInUserRole === 'admin') {
        if (role && ['admin', 'customer'].includes(role)) { // Проверяем допустимые роли
           // Админ не может убрать админский статус у последнего админа (нужна доп. логика)
           // Админ не может понизить себя, если он единственный админ (простая проверка)
           if (loggedInUserId === requestedUserId && role !== 'admin') {
                // Проверить, есть ли другие админы перед понижением
                // const adminCount = await db.query("SELECT COUNT(*) FROM users WHERE role = 'admin'");
                // if (adminCount.rows[0].count <= 1) {
                //     return res.status(400).json({ error: 'Нельзя понизить роль единственного администратора' });
                // }
                // Упрощенно: запрещаем админу менять свою роль через этот эндпоинт
                 console.warn(`Admin user ${loggedInUserId} attempted to change their own role via PUT /api/users/:id`);
           } else if (loggedInUserId !== requestedUserId) {
               finalRole = role; // Админ может менять роль других
           }
        } else if (role) {
             return res.status(400).json({ error: 'Недопустимое значение для роли' });
        }
        // Если role не передана админом, используется текущая роль пользователя
         if (!role && loggedInUserId !== requestedUserId) {
             const targetUser = await db.query('SELECT role FROM users WHERE id = $1', [requestedUserId]);
             if (targetUser.rows.length > 0) {
                 finalRole = targetUser.rows[0].role;
             }
         }

    } else {
        // Обычный пользователь не может менять роль
        if (role && role !== req.user.role) {
            return res.status(403).json({ error: 'Недостаточно прав для изменения роли' });
        }
        finalRole = req.user.role; // Оставляем текущую роль
    }


    try {
        const sql = `
            UPDATE users SET name=$1, surname=$2, email=$3, phone=$4, role=$5
            WHERE id = $6
            RETURNING id, username, name, surname, email, phone, role`; // Не возвращаем хеш

        const { rows, rowCount } = await db.query(sql, [
            name, surname, email, phone || null,
            finalRole,
            requestedUserId
        ]);

        if (rowCount === 0) {
            // Это не должно произойти, если пользователь авторизован и ID верный
            return res.status(404).json({ error: 'Пользователь не найден для обновления' });
        }
        res.json(rows[0]);
    } catch (err) {
        console.error(`Ошибка при обновлении пользователя ${requestedUserId}:`, err);
        if (err.code === '23505' && err.constraint === 'users_email_key') {
            return res.status(409).json({ error: `Email '${email}' уже зарегистрирован.` });
        }
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});


// DELETE /api/users/:id - Удалить пользователя (только админ)
router.delete('/:id', isAdmin, async (req, res) => { // Добавляем isAdmin middleware
  const requestedUserId = parseInt(req.params.id, 10);
  const loggedInUserId = req.user.id;

  // Дополнительная защита: админ не может удалить сам себя
  if (loggedInUserId === requestedUserId) {
      return res.status(400).json({ error: 'Администратор не может удалить собственную учетную запись.' });
  }

  try {
     // Учитывайте ON DELETE в orders
    const { rowCount } = await db.query('DELETE FROM users WHERE id = $1', [requestedUserId]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Пользователь не найден для удаления' });
    }
    res.status(204).send(); // No Content
  } catch (err) {
    console.error(`Ошибка при удалении пользователя ${requestedUserId}:`, err);
     if (err.code === '23503') {
        return res.status(409).json({ error: 'Невозможно удалить пользователя, так как у него есть связанные данные (например, заказы).' });
    }
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});


module.exports = router;
