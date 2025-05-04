// routes/performances.js
const express = require('express');
const router = express.Router();
const path = require('path'); // Модуль для работы с путями
const fs = require('fs'); // Модуль для работы с файловой системой
const multer = require('multer'); // Импортируем multer
const db = require('../db');
const { protect, isAdmin } = require('../middleware/authMiddleware');

// --- Настройка Multer ---
const storage = multer.diskStorage({
  // Куда сохранять файлы
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, '..', 'public', 'uploads', 'performances');
    // Убедимся, что папка существует
    fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  // Как называть файлы
  filename: function (req, file, cb) {
    // Генерируем уникальное имя: fieldname-timestamp.ext
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// Фильтр файлов - принимаем только изображения
const imageFileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Недопустимый тип файла! Разрешены только изображения.'), false);
  }
};

// Создаем middleware multer с настройками
const upload = multer({
    storage: storage,
    fileFilter: imageFileFilter,
    limits: { fileSize: 5 * 1024 * 1024 } // Ограничение размера файла (например, 5MB)
});
// ------------------------

// --- Вспомогательная функция для получения полного URL изображения ---
function getImageUrl(req, filename) {
    if (!filename) return null;
    // Получаем базовый URL сервера (протокол + хост)
    // В продакшене лучше брать из переменных окружения BASE_URL
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    // Собираем полный URL к файлу
    return `${baseUrl}/uploads/performances/${filename}`;
}
// --------------------------------------------------------------------


// GET /api/performances - Получить список (Доступен всем)
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT p.id, p.title, p.description, pt.type_name, pr.full_name as producer_name,
             p.duration_minutes, p.age_restriction, p.image_filename
      FROM performances p
      LEFT JOIN performance_types pt ON p.type_id = pt.id
      LEFT JOIN producers pr ON p.producer_id = pr.id
      ORDER BY p.title
    `);
    // Добавляем полный URL к изображению для каждого спектакля
    const performancesWithImages = rows.map(p => ({
        ...p,
        imageUrl: getImageUrl(req, p.image_filename)
    }));
    res.json(performancesWithImages);
  } catch (err) {
    console.error('Ошибка при получении представлений:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// GET /api/performances/:id - Получить детали (Доступен всем)
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query(`
      SELECT p.id, p.title, p.description, p.type_id, pt.type_name, p.producer_id, pr.full_name as producer_name,
             p.duration_minutes, p.age_restriction, p.image_filename
      FROM performances p
      LEFT JOIN performance_types pt ON p.type_id = pt.id
      LEFT JOIN producers pr ON p.producer_id = pr.id
      WHERE p.id = $1
    `, [id]);

    if (rows.length === 0) {
      return res.status(404).send('Представление не найдено');
    }
    const performance = rows[0];
    performance.imageUrl = getImageUrl(req, performance.image_filename); // Добавляем URL
    res.json(performance);
  } catch (err) {
    console.error(`Error fetching performance ${id}:`, err);
    res.status(500).send('Internal Server Error');
  }
});

// POST /api/performances - Добавить (Только админ)
// Используем upload.single('image'), где 'image' - имя поля в form-data для файла
router.post('/', protect, isAdmin, upload.single('image'), async (req, res) => {
  // Данные из формы теперь в req.body, файл в req.file
  const { title, type_id, producer_id, description, duration_minutes, age_restriction } = req.body;
  const image_filename = req.file ? req.file.filename : null; // Получаем имя сохраненного файла

  if (!title || !type_id) {
    // Если была ошибка загрузки файла до этой проверки, multer мог сохранить файл.
    // В идеале нужно удалить файл, если валидация формы не прошла.
    if (image_filename) {
         fs.unlink(path.join(req.file.destination, image_filename), (err) => {
            if (err) console.error("Ошибка удаления файла при неудачном POST:", err);
         });
    }
    return res.status(400).send('Требуется название (title) и ID типа (type_id).');
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO performances (title, type_id, producer_id, description, duration_minutes, age_restriction, image_filename)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [title, type_id, producer_id || null, description || null, duration_minutes || null, age_restriction || null, image_filename] // Сохраняем имя файла
    );
    const newPerformance = rows[0];
    newPerformance.imageUrl = getImageUrl(req, newPerformance.image_filename); // Добавляем URL в ответ
    res.status(201).json(newPerformance);
  } catch (err) {
     // Удаляем загруженный файл, если вставка в БД не удалась
     if (image_filename) {
         fs.unlink(path.join(req.file.destination, image_filename), (unlinkErr) => {
            if (unlinkErr) console.error("Ошибка удаления файла при ошибке БД:", unlinkErr);
         });
     }
    console.error('Ошибка при добавлении представления:', err);
    if (err.code === '23503') {
         return res.status(400).send('Указанный тип (type_id) или продюсер (producer_id) не существует.');
    }
    res.status(500).send('Internal Server Error');
  }
});

// PUT /api/performances/:id - Обновить (Только админ)
router.put('/:id', protect, isAdmin, upload.single('image'), async (req, res) => {
    const { id } = req.params;
    const { title, type_id, producer_id, description, duration_minutes, age_restriction } = req.body;
    const new_image_filename = req.file ? req.file.filename : undefined; // Новое имя файла, если загружен

    if (!title || !type_id) {
        // Удаляем новый файл, если он был загружен, а валидация не прошла
        if (new_image_filename) {
             fs.unlink(path.join(req.file.destination, new_image_filename), (err) => {
                if (err) console.error("Ошибка удаления файла при неудачном PUT:", err);
             });
        }
        return res.status(400).send('Требуется название (title) и ID типа (type_id).');
    }

    let old_image_filename = null;

    try {
        // Получаем имя старого файла, чтобы удалить его после успешного обновления
        if (new_image_filename !== undefined) { // Если загружен новый файл (даже если null пришел)
            const oldData = await db.query('SELECT image_filename FROM performances WHERE id = $1', [id]);
            if (oldData.rows.length > 0) {
                old_image_filename = oldData.rows[0].image_filename;
            }
        }

        // Собираем запрос на обновление
        let sql = 'UPDATE performances SET title = $1, type_id = $2, producer_id = $3, description = $4, duration_minutes = $5, age_restriction = $6';
        const params = [title, type_id, producer_id || null, description || null, duration_minutes || null, age_restriction || null];

        // Добавляем обновление имени файла, только если новый файл был загружен
        if (new_image_filename !== undefined) {
            params.push(new_image_filename); // null или имя файла
            sql += `, image_filename = $${params.length}`;
        }

        params.push(id); // ID для WHERE
        sql += ` WHERE id = $${params.length} RETURNING *`;

        const { rows, rowCount } = await db.query(sql, params);

        if (rowCount === 0) {
            // Если спектакль не найден, удаляем новый загруженный файл
             if (new_image_filename) {
                 fs.unlink(path.join(req.file.destination, new_image_filename), (err) => { if (err) console.error("Ошибка удаления файла при 404 на PUT:", err);});
             }
            return res.status(404).send('Представление не найдено для обновления');
        }

        // Если обновление успешно и был загружен новый файл, удаляем старый файл (если он был)
        if (new_image_filename !== undefined && old_image_filename) {
             fs.unlink(path.join(__dirname, '..', 'public', 'uploads', 'performances', old_image_filename), (err) => {
                if (err && err.code !== 'ENOENT') { // Игнорируем ошибку, если файла и так не было
                    console.error("Ошибка удаления старого файла изображения:", err);
                } else if (!err) {
                    console.log("Старый файл изображения удален:", old_image_filename);
                }
            });
        }

        const updatedPerformance = rows[0];
        updatedPerformance.imageUrl = getImageUrl(req, updatedPerformance.image_filename); // Добавляем URL в ответ
        res.json(updatedPerformance);

    } catch (err) {
        // Удаляем новый загруженный файл при ошибке БД
        if (new_image_filename) {
             fs.unlink(path.join(req.file.destination, new_image_filename), (unlinkErr) => {
                if (unlinkErr) console.error("Ошибка удаления файла при ошибке БД в PUT:", unlinkErr);
             });
        }
        console.error(`Error updating performance ${id}:`, err);
         if (err.code === '23503') {
            return res.status(400).send('Указанный тип (type_id) или продюсер (producer_id) не существует.');
        }
        res.status(500).send('Internal Server Error');
    }
});

// DELETE /api/performances/:id - Удалить (Только админ)
router.delete('/:id', protect, isAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        // Сначала получаем имя файла, чтобы удалить его
        const fileData = await db.query('SELECT image_filename FROM performances WHERE id = $1', [id]);
        const filenameToDelete = fileData.rows.length > 0 ? fileData.rows[0].image_filename : null;

        // Удаляем запись из БД
        const { rowCount } = await db.query('DELETE FROM performances WHERE id = $1', [id]);

        if (rowCount === 0) {
            return res.status(404).send('Представление не найдено для удаления');
        }

        // Если запись удалена и был файл, удаляем файл
        if (filenameToDelete) {
             fs.unlink(path.join(__dirname, '..', 'public', 'uploads', 'performances', filenameToDelete), (err) => {
                 if (err && err.code !== 'ENOENT') {
                    console.error("Ошибка удаления файла изображения при DELETE:", err);
                 } else if (!err) {
                    console.log("Файл изображения удален:", filenameToDelete);
                 }
             });
        }

        res.status(204).send();
    } catch (err) {
        console.error(`Error deleting performance ${id}:`, err);
        if (err.code === '23503') {
            return res.status(409).send('Невозможно удалить представление, так как оно используется в расписании или ролях.');
        }
        res.status(500).send('Internal Server Error');
    }
});

module.exports = router;
