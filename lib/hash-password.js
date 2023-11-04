const bcrypt = require('bcrypt');
const plaintextPassword = process.argv0
const saltRounds = 10;

bcrypt.hash(plaintextPassword, saltRounds, function (err, hash) {
    if (err) {
        console.log(err);
        return;
    }
    console.log(hash)
});