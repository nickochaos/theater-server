// routes/news.js
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const slugify = require('slugify'); // Для генерации слагов
const db = require('../db');
const { protect, isAdmin } = require('../middleware/authMiddleware');

// --- Настройка Multer для новостей ---
const newsStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, '..', 'public', 'uploads', 'news');
    fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'news-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const imageFileFilter = (req, file, cb) => { /* ... тот же фильтр для картинок ... */
  if (file.mimetype.startsWith('image/')) { cb(null, true); }
  else { cb(new Error('Недопустимый тип файла! Разрешены только изображения.'), false); }
};

const newsUpload = multer({
    storage: newsStorage,
    fileFilter: imageFileFilter,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});
// ------------------------------------

// --- Вспомогательная функция для URL изображения ---
function getNewsImageUrl(req, filename) {
    if (!filename) return null;
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    return `${baseUrl}/uploads/news/${filename}`;
}
// -------------------------------------------------

// --- Вспомогательная функция для генерации уникального слага ---
async function generateUniqueSlug(title, currentId = null) {
    let baseSlug = slugify(title, { lower: true, strict: true, locale: 'ru' });
    let slug = baseSlug;
    let counter = 1;
    let existing = null;

    do {
        let sql = 'SELECT id FROM news_articles WHERE slug = $1';
        const params = [slug];
        // При обновлении исключаем текущую запись из проверки уникальности
        if (currentId) {
            sql += ' AND id != $2';
            params.push(currentId);
        }
        const result = await db.query(sql, params);
        existing = result.rows.length > 0;
        if (existing) {
            slug = `${baseSlug}-${counter}`;
            counter++;
        }
    } while (existing);

    return slug;
}
// ----------------------------------------------------------

// GET /api/news - Список новостей для сайта (публичный)
router.get('/', async (req, res) => {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const offset = (page - 1) * limit;

    try {
        // Получаем общее количество опубликованных новостей
        const totalResult = await db.query("SELECT COUNT(*) FROM news_articles WHERE is_published = TRUE");
        const totalItems = parseInt(totalResult.rows[0].count, 10);

        // Получаем новости для текущей страницы
        const sql = `
            SELECT id, title, content, publication_date as "publicationDate", image_filename, slug,
                   (SELECT username FROM users WHERE id = author_id) as "authorUsername" -- Имя автора
            FROM news_articles
            WHERE is_published = TRUE
            ORDER BY publication_date DESC
            LIMIT $1 OFFSET $2`;
        const { rows } = await db.query(sql, [limit, offset]);

        // Формируем ответ с пагинацией
        res.json({
            totalPages: Math.ceil(totalItems / limit),
            currentPage: page,
            totalItems: totalItems,
            items: rows.map(n => ({ ...n, imageUrl: getNewsImageUrl(req, n.image_filename) }))
        });
    } catch (err) {
        console.error('Ошибка при получении новостей:', err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// GET /api/news/slug/:slug - Одна новость по слагу (публичный)
router.get('/slug/:slug', async (req, res) => {
    const { slug } = req.params;
    try {
        const sql = `
            SELECT id, title, content, publication_date as "publicationDate", image_filename, slug, is_published,
                   author_id, (SELECT username FROM users WHERE id = author_id) as "authorUsername"
            FROM news_articles
            WHERE slug = $1 AND is_published = TRUE`; // Только опубликованные
        const { rows } = await db.query(sql, [slug]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Новость не найдена или не опубликована' });
        }
        const newsItem = rows[0];
        newsItem.imageUrl = getNewsImageUrl(req, newsItem.image_filename);
        res.json(newsItem);
    } catch (err) {
        console.error(`Ошибка при получении новости по слагу ${slug}:`, err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});


// --- АДМИНСКИЕ МАРШРУТЫ ---

// GET /api/news/admin/all - Все новости для админа (с пагинацией)
router.get('/admin/all', protect, isAdmin, async (req, res) => {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20; // Больше лимит для админки
    const offset = (page - 1) * limit;
     try {
        const totalResult = await db.query("SELECT COUNT(*) FROM news_articles");
        const totalItems = parseInt(totalResult.rows[0].count, 10);

        const sql = `
            SELECT id, title, publication_date as "publicationDate", is_published, slug,
                   author_id, (SELECT username FROM users WHERE id = author_id) as "authorUsername"
            FROM news_articles
            ORDER BY publication_date DESC
            LIMIT $1 OFFSET $2`;
        const { rows } = await db.query(sql, [limit, offset]);

        res.json({
            totalPages: Math.ceil(totalItems / limit),
            currentPage: page,
            totalItems: totalItems,
            items: rows // Для админки полный URL картинки не так важен в списке
        });
    } catch (err) {
        console.error('Ошибка при получении всех новостей админом:', err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});


// GET /api/news/:id - Одна новость по ID для админа
router.get('/:id', protect, isAdmin, async (req, res) => {
    const { id } = req.params;
     try {
        const sql = `
            SELECT id, title, content, publication_date as "publicationDate", image_filename, slug, is_published,
                   author_id, (SELECT username FROM users WHERE id = author_id) as "authorUsername"
            FROM news_articles
            WHERE id = $1`;
        const { rows } = await db.query(sql, [id]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Новость не найдена' });
        }
        const newsItem = rows[0];
        newsItem.imageUrl = getNewsImageUrl(req, newsItem.image_filename);
        res.json(newsItem);
    } catch (err) {
        console.error(`Ошибка при получении новости ${id} админом:`, err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// POST /api/news - Создать новость (админ)
router.post('/', protect, isAdmin, newsUpload.single('image'), async (req, res) => {
    const { title, content, is_published = true } = req.body; // is_published по умолчанию true
    const image_filename = req.file ? req.file.filename : null;
    const author_id = req.user.id;

    if (!title || !content) {
        // Удаляем файл, если валидация не прошла
        if (image_filename) fs.unlink(path.join(req.file.destination, image_filename), (err) => {});
        return res.status(400).json({ error: 'Требуются заголовок (title) и содержание (content)' });
    }

    try {
        const slug = await generateUniqueSlug(title); // Генерируем уникальный слаг

        const sql = `
            INSERT INTO news_articles (title, content, author_id, is_published, image_filename, slug)
            VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`;
        const { rows } = await db.query(sql, [
            title, content, author_id,
            (is_published === 'true' || is_published === true), // Приводим к boolean
            image_filename, slug
        ]);
        const newNews = rows[0];
        newNews.imageUrl = getNewsImageUrl(req, newNews.image_filename);
        res.status(201).json(newNews);
    } catch (err) {
        if (image_filename) fs.unlink(path.join(req.file.destination, image_filename), (err) => {});
        console.error('Ошибка при добавлении новости:', err);
        if (err.code === '23505' && err.constraint === 'news_articles_slug_key') {
             return res.status(409).json({ error: 'Новость с таким URL (slug) уже существует. Измените заголовок.' });
        }
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// PUT /api/news/:id - Обновить новость (админ)
router.put('/:id', protect, isAdmin, newsUpload.single('image'), async (req, res) => {
    const { id } = req.params;
    const { title, content, is_published, delete_image } = req.body; // delete_image - флаг для удаления картинки
    const new_image_filename = req.file ? req.file.filename : undefined; // Новый файл
    let old_image_filename = null;
    let slug = undefined; // Слаг будет обновлен только если изменился title

    if (!title || !content) {
        if (new_image_filename) fs.unlink(path.join(req.file.destination, new_image_filename), (err) => {});
        return res.status(400).json({ error: 'Требуются заголовок (title) и содержание (content)' });
    }

    try {
        // Получаем текущие данные, включая слаг и имя старого файла
        const currentDataRes = await db.query('SELECT slug, image_filename FROM news_articles WHERE id = $1', [id]);
        if (currentDataRes.rows.length === 0) {
            if (new_image_filename) fs.unlink(path.join(req.file.destination, new_image_filename), (err) => {});
            return res.status(404).json({ error: 'Новость не найдена для обновления' });
        }
        const currentData = currentDataRes.rows[0];
        old_image_filename = currentData.image_filename;

        // Генерируем новый слаг, только если заголовок изменился
        const currentSlugBase = currentData.slug.replace(/-\d+$/, ''); // Убираем суффикс -N
        const newTitleSlugBase = slugify(title, { lower: true, strict: true, locale: 'ru' });
        if (newTitleSlugBase !== currentSlugBase) {
            slug = await generateUniqueSlug(title, id); // Генерируем новый уникальный слаг
        }

        // Определяем итоговое имя файла
        let final_image_filename;
        if (delete_image === 'true') {
            final_image_filename = null; // Удаляем картинку
        } else if (new_image_filename !== undefined) {
            final_image_filename = new_image_filename; // Заменяем картинку
        } else {
            final_image_filename = old_image_filename; // Оставляем старую
        }

        // Собираем запрос
        let sql = 'UPDATE news_articles SET title=$1, content=$2, is_published=$3';
        const params = [title, content, (is_published === 'true' || is_published === true)];

        if (slug !== undefined) { // Обновляем слаг, если он изменился
            params.push(slug);
            sql += `, slug = $${params.length}`;
        }
        // Обновляем имя файла (может быть null, новое имя или старое имя)
        params.push(final_image_filename);
        sql += `, image_filename = $${params.length}`;

        params.push(id);
        sql += ` WHERE id = $${params.length} RETURNING *`;

        const { rows, rowCount } = await db.query(sql, params);

        // Удаляем старый файл, если он был и его заменили или удалили
        const shouldDeleteOld = (new_image_filename !== undefined || delete_image === 'true') && old_image_filename;
        if (shouldDeleteOld && final_image_filename !== old_image_filename) { // Доп. проверка, чтобы не удалить тот же файл
            fs.unlink(path.join(__dirname, '..', 'public', 'uploads', 'news', old_image_filename), (err) => {
                if (err && err.code !== 'ENOENT') console.error("Ошибка удаления старого файла новости:", err);
            });
        }

        const updatedNews = rows[0];
        updatedNews.imageUrl = getNewsImageUrl(req, updatedNews.image_filename);
        res.json(updatedNews);

    } catch (err) {
        if (new_image_filename) fs.unlink(path.join(req.file.destination, new_image_filename), (err) => {});
        console.error(`Ошибка при обновлении новости ${id}:`, err);
        if (err.code === '23505' && err.constraint === 'news_articles_slug_key') {
            return res.status(409).json({ error: 'Новость с таким URL (slug) уже существует. Измените заголовок.' });
        }
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});


// DELETE /api/news/:id - Удалить новость (админ)
router.delete('/:id', protect, isAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        // Получаем имя файла перед удалением из БД
        const fileData = await db.query('SELECT image_filename FROM news_articles WHERE id = $1', [id]);
        const filenameToDelete = fileData.rows.length > 0 ? fileData.rows[0].image_filename : null;

        // Удаляем из БД
        const { rowCount } = await db.query('DELETE FROM news_articles WHERE id = $1', [id]);
        if (rowCount === 0) {
            return res.status(404).json({ error: 'Новость не найдена для удаления' });
        }

        // Удаляем файл, если он был
        if (filenameToDelete) {
            fs.unlink(path.join(__dirname, '..', 'public', 'uploads', 'news', filenameToDelete), (err) => {
                 if (err && err.code !== 'ENOENT') console.error("Ошибка удаления файла новости:", err);
            });
        }
        res.status(204).send(); // No Content
    } catch (err) {
        console.error(`Ошибка при удалении новости ${id}:`, err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

module.exports = router;
