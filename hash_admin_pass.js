// hash_admin_pass.js
const bcrypt = require('bcrypt');
const saltRounds = 10;
const plainPassword = '12345'; // ЗАМЕНИТЕ ЭТО!

bcrypt.hash(plainPassword, saltRounds).then(hash => {
    console.log('Plain Password:', plainPassword);
    console.log('Hashed Password:', hash);
}).catch(err => {
    console.error('Error hashing password:', err);
});
