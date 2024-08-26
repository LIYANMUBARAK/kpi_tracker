import express from 'express'
import { captureCode, formSubmission, getAccessToken, handleContactData, initiateAuth } from '../controllers/authController'
const router = express.Router()

router.get('/',getAccessToken)
router.get('/initiateAuth',initiateAuth)        //to initiate the connection and get the auth code
router.get('/capturecode',captureCode)
router.post('/submit',formSubmission)
router.post('/handleContactdata',handleContactData)

export default router