import mysql from 'mysql2/promise';
import 'dotenv/config';

// Create a connection pool
const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,  // Adjust based on your application's needs
    queueLimit: 0
});

export default pool;
