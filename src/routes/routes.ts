import express from 'express'
import { captureCode, formSubmission, getAccessToken,  initialOpportunityFetch, initialOpportunityFetchHtml, initiateAuth, renderGoalForm, updateGoal } from '../controllers/authController'
import { handleOpportunityWebhook } from '../controllers/updateController'
const router = express.Router()

router.get('/',getAccessToken)
router.get('/initiateAuth',initiateAuth)        //to initiate the connection and get the auth code
router.get('/capturecode',captureCode)
router.post('/submit',formSubmission)
// router.post('/handleContactdata',handleContactData)

router.get('/getExistingOpportunities',initialOpportunityFetchHtml)
router.post('/getExistingOpportunitiesForLocation',initialOpportunityFetch)

router.post('/webhook',handleOpportunityWebhook)

router.get('/goalForm',renderGoalForm)
router.post('/update-goal', updateGoal);


export default router