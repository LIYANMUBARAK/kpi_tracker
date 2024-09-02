import { Request, Response } from 'express'
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import mysql from 'mysql2/promise';
import pool from '../shared/dbConnectionPool';



import 'dotenv/config';
import { fetchAuthTokenForLocation, formatDateForMySQL } from './authController';



interface OpportunityData {
    id: string;
    name: string;
    monetaryValue: number;
    pipelineId: string;
    pipelineStageId: string;
    status: string;
    source: string;
    assignedTo: string;
    lastStatusChangeAt: string;
    lastStageChangeAt: string;
    createdAt: string;
    contact: {
        id: string;
        name: string;
        email: string;
        phone: string;
    };
}

async function handleOpportunityWebhook(req: Request, res: Response) {
    let connection: mysql.PoolConnection | undefined;

    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const payload = req.body;
        const { type, id, locationId, assignedTo, contactId, monetaryValue, name, pipelineId, pipelineStageId, source, status, dateAdded } = payload;
        switch (type) {
            case 'OpportunityCreate': {
                console.log("Request for Opportunity Create :"+name)
                const accessToken = await fetchAuthTokenForLocation(locationId);
            
                // Update the API URL to fetch opportunity data
                const options = {
                    method: 'GET',
                    url: `https://services.leadconnectorhq.com/opportunities/${id}`, // Use `id` for the opportunity
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${accessToken}`,
                        'Version': '2021-07-28',
                        'Accept': 'application/json'
                    }
                };
            
                const { data } = await axios.request(options);
                const opportunityData = data.opportunity;
                console.log(opportunityData)
                const {
                    id: fetchedOpportunityId,
                    name: opportunityName,
                    monetaryValue: oppMonetaryValue,
                    pipelineId: oppPipelineId,
                    pipelineStageId,
                    status: oppStatus,
                    source: oppSource,
                    assignedTo: oppAssignedTo,
                    lastStatusChangeAt,
                    lastStageChangeAt,
                    createdAt,
                    updatedAt,
                    contactId: fetchedContactId,
                    contact: {
                        name: contactName,
                        email: contactEmail,
                        phone: contactPhone,
                    },
                } = opportunityData;
            
                // Convert dates to MySQL format
                const mysqlLastStatusChangeAt = formatDateForMySQL(lastStatusChangeAt);
                const mysqlLastStageChangeAt = formatDateForMySQL(lastStageChangeAt);
                const mysqlCreatedAt = formatDateForMySQL(createdAt);
                const mysqlUpdatedAt = formatDateForMySQL(updatedAt);
            
                // Sanitize values to replace `undefined` with `null`
                const sanitizedAssignedTo = oppAssignedTo ?? null;
                const sanitizedMonetaryValue = oppMonetaryValue ?? null;
                const sanitizedPipelineId = oppPipelineId ?? null;
                const sanitizedStatus = oppStatus ?? null;
                const sanitizedSource = oppSource ?? null;
                const sanitizedLastStatusChangeAt = mysqlLastStatusChangeAt ?? null;
                const sanitizedLastStageChangeAt = mysqlLastStageChangeAt ?? null;
                const sanitizedCreatedAt = mysqlCreatedAt ?? null;
                const sanitizedUpdatedAt = mysqlUpdatedAt ?? null;
                const sanitizedContactId = fetchedContactId ?? null;
                const sanitizedOpportunityName = opportunityName ?? null;
                const sanitizedContactName = contactName ?? null;
                const sanitizedContactEmail = contactEmail ?? null;
                const sanitizedContactPhone = contactPhone ?? null;
            
                const connection = await pool.getConnection();
                try {
                    await connection.beginTransaction();
            
                    // Check if assignedTo exists in the assigned_to table
                    const [assignedToRows]: any[] = await connection.execute(`
                        SELECT assignedTo FROM assigned_to WHERE id = ?
                    `, [sanitizedAssignedTo]);
            
                    let assignedToName: string | null = null;
            
                    // If assignedTo doesn't exist, fetch details from GHL API and insert into the assigned_to table
                    if (sanitizedAssignedTo && assignedToRows.length === 0) {
                        const userOptions = {
                            method: 'GET',
                            url: `https://services.leadconnectorhq.com/users/${sanitizedAssignedTo}`,
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${accessToken}`,
                                'Version': '2021-07-28'
                            }
                        };
            
                        const { data: assignedToData } = await axios.request(userOptions);
                        const { id, name, email, phone } = assignedToData;
            
                        // Insert assignedTo data into the assigned_to table
                        await connection.execute(`
                            INSERT INTO assigned_to (id, assignedTo,  assignedTo_email, assignedTo_phone)
                            VALUES (?, ?, ?, ?)
                        `, [id, name, email, phone]);
            
                        assignedToName = name;
                    } else {
                        assignedToName = assignedToRows[0]?.contact_name ?? null;
                    }
            
                    // Insert or update opportunity data in the opportunity_data table
                    await connection.execute(`
                        INSERT INTO opportunity_data (
                            contactId, contact_name, contact_email, contact_phone, 
                            opportunity_id, opportunity_name, status, pipelineId, 
                            monetaryValue, source, updatedAt, assignedTo, 
                            lastStatusChangeAt, lastStageChangeAt, createdAt
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON DUPLICATE KEY UPDATE 
                            contact_name = VALUES(contact_name),
                            contact_email = VALUES(contact_email),
                            contact_phone = VALUES(contact_phone),
                            opportunity_name = VALUES(opportunity_name),
                            status = VALUES(status),
                            pipelineId = VALUES(pipelineId),
                            monetaryValue = VALUES(monetaryValue),
                            source = VALUES(source),
                            updatedAt = VALUES(updatedAt),
                            assignedTo = VALUES(assignedTo),
                            lastStatusChangeAt = VALUES(lastStatusChangeAt),
                            lastStageChangeAt = VALUES(lastStageChangeAt),
                            createdAt = VALUES(createdAt)
                    `, [
                        sanitizedContactId, sanitizedContactName, sanitizedContactEmail, sanitizedContactPhone,
                        fetchedOpportunityId, sanitizedOpportunityName, sanitizedStatus, sanitizedPipelineId,
                        sanitizedMonetaryValue, sanitizedSource, sanitizedUpdatedAt, assignedToName,
                        sanitizedLastStatusChangeAt, sanitizedLastStageChangeAt, sanitizedCreatedAt,
                    ]);
            
                    // Fetch the stage name using the pipelineStageId
                    const [stageRows]: any[] = await connection.execute(
                        `SELECT stage_name FROM stages WHERE stage_id = ?`,
                        [pipelineStageId]
                    );
            
                    if (stageRows.length > 0) {
                        const stageName = stageRows[0].stage_name;
                        const sanitizedColumnName = `stage_${stageName.replace(/\W+/g, '_')}`;
            
                        // Update opportunity_data table with the correct stage name and lastStageChangeAt
                        await connection.execute(
                            `
                            UPDATE opportunity_data
                            SET ${mysql.escapeId(sanitizedColumnName)} = ?
                            WHERE opportunity_id = ?
                        `,
                            [sanitizedLastStageChangeAt, fetchedOpportunityId]
                        );

                          // If the stage is "Sale Closed Onboard", update the goal_achieved and pace_so_far in assigned_to table
                   if (sanitizedColumnName === 'stage_Sale_Closed_Onboard_') {
                    const [assignedToData]: any[] = await connection.execute(`
                        SELECT minimum_goal, goal_achieved FROM assigned_to WHERE id = ?
                    `, [assignedTo]);

                    if (assignedToData.length > 0) {
                        let { minimum_goal, goal_achieved } = assignedToData[0];
                        goal_achieved += monetaryValue;

                        // Calculate pace_so_far
                        const currentMonth = new Date().getMonth() + 1;
                        const remainingMonths = 12 - currentMonth;
                        let pace_so_far = (minimum_goal - goal_achieved) / remainingMonths;
                        if (pace_so_far < 0) {
                            pace_so_far = 0;
                        }

                        // Update the assigned_to table with the new goal_achieved and pace_so_far values
                        await connection.execute(`
                            UPDATE assigned_to
                            SET goal_achieved = ?, pace_so_far = ?
                            WHERE id = ?
                        `, [goal_achieved, pace_so_far, assignedTo]);
                    }
                }
                    }
            
                    await connection.commit();
                } catch (error) {
                    await connection.rollback();
                    console.error('Error updating opportunity data:', error);
                    throw error;
                } finally {
                    connection.release();
                }
            
                break;
            }
            

            case 'OpportunityDelete': {
                console.log("Request for Opportunity delete :"+name)
                await connection.execute(`
                    DELETE FROM opportunity_data 
                    WHERE opportunity_id = ?
                `, [id]);

                break;
            }


            case 'OpportunityStageUpdate': {
                console.log("Request for Opportunity Stage Update :"+name)
                const accessToken = await fetchAuthTokenForLocation(locationId);
        
                // Update the API URL to fetch opportunity data
                const options = {
                    method: 'GET',
                    url: `https://services.leadconnectorhq.com/opportunities/${id}`, // Use `id` for the opportunity
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${accessToken}`,
                        'Version': '2021-07-28',
                        'Accept': 'application/json'
                    }
                };
        
                const { data } = await axios.request(options);
                const opportunityData = data.opportunity;

                const [stageRows]: any[] = await connection.execute(`
                    SELECT stage_name FROM stages WHERE stage_id = ?
                `, [pipelineStageId]);

                if (stageRows.length > 0) {
                    const stageName = stageRows[0].stage_name;
                    const sanitizedColumnName = `stage_${stageName.replace(/\W+/g, '_')}`;
                    const escapedColumnName = mysql.escape(sanitizedColumnName);

                    // Ensure the column exists in the opportunity_data table before updating
                    const [columnCheck]: any[] = await connection.execute(`
                        SHOW COLUMNS FROM opportunity_data LIKE ${escapedColumnName}
                    `);
                        const lastStageChangeAt = formatDateForMySQL(opportunityData.lastStageChangeAt)
                        const updatedAt = formatDateForMySQL(opportunityData.updatedAt)
                    if (columnCheck.length > 0) {
            // Update the stage column and updatedAt
            await connection.execute(`
                UPDATE opportunity_data
                SET ${mysql.escapeId(sanitizedColumnName)} = ?, updatedAt = ?
                WHERE opportunity_id = ?
            `, [lastStageChangeAt, updatedAt, id]);

            // Check if the stage is 'Sale_Closed_Onboard'
            if (stageName === 'Sale_Closed_Onboard') {
                // Fetch the current goal values for the assigned user
                const [goalData]: any[] = await connection.execute(`
                    SELECT minimum_goal, goal_achieved FROM assigned_to WHERE id = ?
                `, [opportunityData.assignedTo]);

                if (goalData.length > 0) {
                    let { minimum_goal, goal_achieved } = goalData[0];
                
                    // Ensure minimum_goal and goal_achieved are numbers
                    minimum_goal = parseFloat(minimum_goal) || 0;
                    goal_achieved = parseFloat(goal_achieved) || 0;
                
                    // Update the goal_achieved by adding opportunityData.monetaryValue
                    const monetaryValue = parseFloat(opportunityData.monetaryValue) || 0;
                    goal_achieved += monetaryValue;
                
                    // Calculate the remaining months until the end of the year
                    const currentMonth = new Date().getMonth() + 1; // Months are zero-indexed
                    const remainingMonths = 12 - currentMonth;
                
                    // Calculate the pace_so_far
                    let pace_so_far = (minimum_goal - goal_achieved) / remainingMonths;
                    
                    // Ensure pace_so_far is not less than 0
                    pace_so_far = Math.max(pace_so_far, 0);
                
                    // Update the assigned_to table with the new goal_achieved and pace_so_far values
                    await connection.execute(`
                        UPDATE assigned_to
                        SET goal_achieved = ?, pace_so_far = ?
                        WHERE id = ?
                    `, [goal_achieved, pace_so_far, opportunityData.assignedTo]);
                }
            }
        } else {
            console.warn(`Column ${sanitizedColumnName} does not exist in opportunity_data table.`);
        }
    } else {
        console.warn(`Stage with id ${opportunityData.pipelineStageId} not found.`);
    }

    break;
}
            case 'OpportunityAssignedToUpdate':
            case 'OpportunityMonetaryValueUpdate':
            case 'OpportunityStatusUpdate':
                case 'OpportunityUpdate': {
                    console.log("Request for OpportunityAssignedToUpdate/MonetoryUpdate/StatusUpdate/Update"+name)
                    const {
                        id: opportunityId,
                        assignedTo: newAssignedTo,
                        monetaryValue: oppMonetaryValue,
                        name: opportunityName,
                        source: oppSource,
                        status: oppStatus,
                        locationId,
                    } = payload;
                
                    // Sanitize values to replace `undefined` with `null`
                    const sanitizedAssignedTo = newAssignedTo ?? null;
                    const sanitizedMonetaryValue = oppMonetaryValue ?? null;
                    const sanitizedOpportunityName = opportunityName ?? null;
                    const sanitizedSource = oppSource ?? null;
                    const sanitizedStatus = oppStatus ?? null;
                
                    // Check if the assignedTo value has changed
                    const [currentAssignedToRows]: any[] = await connection.execute(`
                        SELECT assignedTo FROM opportunity_data WHERE opportunity_id = ?
                    `, [opportunityId]);
                
                    if (currentAssignedToRows.length > 0) {
                        const currentAssignedTo = currentAssignedToRows[0].assignedTo;
                
                        if (sanitizedAssignedTo !== currentAssignedTo) {
                            // If assignedTo has changed, check if the new assignedTo exists in the assigned_to table
                            const [assignedToRows]: any[] = await connection.execute(`
                                SELECT assignedTo FROM assigned_to WHERE id = ?
                            `, [sanitizedAssignedTo]);
                
                            let assignedToName: string | null = null;
                
                            if (assignedToRows.length === 0 && sanitizedAssignedTo) {
                                // If not present, fetch details from GHL API and insert into the assigned_to table
                                const options = {
                                    method: 'GET',
                                    url: `https://services.leadconnectorhq.com/users/${sanitizedAssignedTo}`,
                                    headers: {
                                        'Content-Type': 'application/json',
                                        'Authorization': `Bearer ${await fetchAuthTokenForLocation(locationId)}`,
                                        'Version': '2021-07-28'
                                    }
                                };
                
                                try {
                                    const { data: assignedToData } = await axios.request(options);
                                    const {
                                        id: fetchedId = null,
                                        name: fetchedName = null,
                                        email: fetchedEmail = null,
                                        phone: fetchedPhone = null
                                    } = assignedToData || {};
                
                                    // Insert assignedTo data into the assigned_to table
                                    await connection.execute(`
                                        INSERT INTO assigned_to (id, assignedTo, assignedTo_email, assignedTo_phone)
                                        VALUES (?, ?, ?, ?)
                                    `, [fetchedId, fetchedName, fetchedEmail, fetchedPhone]);
                
                                    assignedToName = fetchedName;
                                } catch (error) {
                                    console.log(`Error fetching assignedTo user details: ${error}`);
                                    assignedToName = null;
                                }
                            } else {
                                // Use the existing name from the assigned_to table
                                assignedToName = assignedToRows.length > 0 ? assignedToRows[0].assignedTo : null;
                            }
                
                            // Update the opportunity_data table with the correct assignedTo name
                            await connection.execute(`
                                UPDATE opportunity_data
                                SET 
                                    assignedTo = ? 
                                WHERE 
                                    opportunity_id = ?
                            `, [assignedToName, opportunityId]);
                        }
                    }
                
                    // Update other opportunity fields
                    const updateQuery = `
                        UPDATE opportunity_data
                        SET 
                            monetaryValue = ?, 
                            opportunity_name = ?, 
                            source = ?, 
                            status = ?, 
                            updatedAt = NOW()
                        WHERE 
                            opportunity_id = ?
                    `;
                
                    await connection.execute(updateQuery, [
                        sanitizedMonetaryValue,
                        sanitizedOpportunityName,
                        sanitizedSource,
                        sanitizedStatus,
                        opportunityId,
                    ]);
                
                    console.log(`Opportunity ${opportunityId} has been updated.`);
                
                    break;
                }

           

            default:
                console.warn(`Unhandled webhook type: ${type}`);
        }

        await connection.commit();
        res.status(200).send('Webhook processed successfully');
    } catch (error) {
        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error('Error rolling back transaction:', rollbackError);
            }
            connection.release();
        }
        console.error('Error processing webhook:', error);
        res.status(500).send('Error processing webhook');
    } finally {
        if (connection) {
            connection.release();
        }
    }
}

export { handleOpportunityWebhook };
