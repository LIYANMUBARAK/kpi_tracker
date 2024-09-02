import express, {  Request, Response } from 'express';
import bodyParser from 'body-parser';
import router from './routes/routes';

const app = express();
const port = process.env.PORT;
// Middleware to parse URL-encoded data
app.use(bodyParser.urlencoded({ extended: true }));






app.use('/',router)

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});