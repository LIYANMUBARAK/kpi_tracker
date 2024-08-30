import { Request, Response } from 'express'
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import mysql from 'mysql2/promise';
import pool from '../shared/dbConnectionPool';



import 'dotenv/config';


export async function initiateAuth(req: Request, res: Response) {
    try {
      const authUrl = `https://marketplace.gohighlevel.com/oauth/chooselocation?response_type=code&redirect_uri=${process.env.REDIRECT_URL}&client_id=${process.env.CLIENT_ID}&scope=contacts.readonly locations.readonly users.readonly locations/customFields.readonly opportunities.readonly`;
      res.redirect(authUrl)  //get token from url params
    } catch (error) {
      console.log("Auth initiation failed.Error:" + error)
    }
  }

  export async function captureCode(req:Request,res:Response) {
    try {
        const code = req.query.code as string; // Get the code from the query parameters

        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                 <link href="https://dashboard.kashcallerai.com/static/css/bootstrap5.css" rel="stylesheet">
    <link href="https://dashboard.kashcallerai.com/static/css/select2.min.css" rel="stylesheet">
                <title>Access Code</title>
            </head>
            <body>
            <div class="text-center mt-5">
                <h1>Access Code</h1>
                <p id="code" class="text-muted">${code}</p>
                <button id="copyButton" class="btn btn-success mt-3">Copy Code</button>
                </div>
                <script>
                    document.getElementById('copyButton').addEventListener('click', () => {
                        const code = document.getElementById('code').innerText;
                        navigator.clipboard.writeText(code).then(() => {
                            alert('Code copied to clipboard!');
                        }).catch(err => {
                            console.error('Failed to copy code: ', err);
                        });
                    });
                </script>
            </body>
            </html>
        `);



    } catch (error) {
        console.log("Error:",error)
    }
  }

  export async function getAccessToken(req:Request,res:Response) {
    try {
        // Serve the HTML form

    res.sendFile(path.join(__dirname, '../html', 'index.html'));



    } catch (error) {
        console.log("Error:",error)
    }
  }


  
  export async function formSubmission(req: Request, res: Response) {
      try {
          const { locationId, accessCode } = req.body;
          const connection = await pool.getConnection();
  
          // Check if the location exists in the database
          const [rows]: any[] = await connection.execute(
              'SELECT COUNT(*) AS count FROM api_keys_data WHERE ghl_location_id = ?',
              [locationId]
          );
  
          const count = rows[0].count;
  
          if (count > 0) {
              // Location exists, fetch the existing token
              const validAccessToken = await fetchAuthTokenForLocation(locationId);
  
              // If the above function doesn't throw an error, we have a valid access token
              console.log(`Valid access token for location ${locationId}: ${validAccessToken}`);
               // Read the success HTML file
            const successHtml = fs.readFileSync(path.join(__dirname, '../html', 'accessTokenFetchSuccess.html'), 'utf-8');
            
            // Replace placeholders with actual data
            const responseHtml = successHtml
                .replace('{{locationId}}', locationId)
                .replace('{{accessToken}}', validAccessToken);

            res.send(responseHtml);
          } else {
              // Location doesn't exist, create a new OAuth token
              const encodedParams = new URLSearchParams();
              encodedParams.set('client_id', process.env.CLIENT_ID as string);
              encodedParams.set('client_secret', process.env.CLIENT_SECRET as string);
              encodedParams.set('grant_type', 'authorization_code');
              encodedParams.set('code', accessCode);
              encodedParams.set('redirect_uri', "http://localhost:3000/capturecode/");
  
              const options = {
                  method: 'POST',
                  url: 'https://services.leadconnectorhq.com/oauth/token',
                  headers: {
                      'Content-Type': 'application/x-www-form-urlencoded',
                      Accept: 'application/json'
                  },
                  data: encodedParams.toString(),
              };
  
              const { data } = await axios.request(options);
              console.log(data);
  
              const currentTimestamp = Math.floor(Date.now() / 1000);
              const ghlTokenExpirationTime = currentTimestamp + data.expires_in;
  
              // Insert the new location and tokens into the database
              const insertSql = `
                  INSERT INTO api_keys_data (ghl_location_id, ghl_oauth_token, ghl_refresh_token, ghl_oauth_token_expires_on)
                  VALUES (?, ?, ?, ?);
              `;
              const insertValues = [
                  locationId,
                  data.access_token,
                  data.refresh_token,
                  ghlTokenExpirationTime
              ];
  
              await connection.execute(insertSql, insertValues);
              const successHtml = fs.readFileSync(path.join(__dirname, '../html', 'accessTokenFetchSuccess.html'), 'utf-8');
            
              // Replace placeholders with actual data
              const responseHtml = successHtml
                  .replace('{{locationId}}', locationId)
  
              res.send(responseHtml);
          }
  
          // Close the connection
          connection.release();
      } catch (error) {
          console.error("Error:", error);
          res.status(500).send('An error occurred');
      }
  }
  


 export async function fetchAuthTokenForLocation(locationId: string): Promise<string> {
    const connection = await pool.getConnection();

    try {
        const [rows]: any[] = await connection.execute(
            'SELECT ghl_oauth_token, ghl_refresh_token, ghl_oauth_token_expires_on FROM api_keys_data WHERE ghl_location_id = ?',
            [locationId]
        );

        if (rows.length === 0) {
            throw new Error(`No token found for locationId: ${locationId}`);
        }

        const { ghl_oauth_token, ghl_refresh_token, ghl_oauth_token_expires_on } = rows[0];
        const currentTimestamp = Math.floor(Date.now() / 1000);

        if (ghl_oauth_token_expires_on > currentTimestamp) {
            console.log('Token is still valid. Returning existing token.');
            return ghl_oauth_token;
        }

        console.log('Token has expired. Refreshing token...');
        const encodedParams = new URLSearchParams();
        encodedParams.set('client_id', process.env.CLIENT_ID as string);
        encodedParams.set('client_secret', process.env.CLIENT_SECRET as string);
        encodedParams.set('grant_type', 'refresh_token');
        encodedParams.set('refresh_token', ghl_refresh_token);

        const options = {
            method: 'POST',
            url: 'https://services.leadconnectorhq.com/oauth/token',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json'
            },
            data: encodedParams.toString(),
        };

        const { data } = await axios.request(options);
        const newExpirationTime = currentTimestamp + data.expires_in;

        await connection.execute(
            'UPDATE api_keys_data SET ghl_oauth_token = ?, ghl_refresh_token = ?, ghl_oauth_token_expires_on = ? WHERE ghl_location_id = ?',
            [data.access_token, data.refresh_token, newExpirationTime, locationId]
        );

        console.log('Token refreshed and updated in the database.');
        return data.access_token;

    } catch (error) {
        console.error('Error fetching or refreshing the token:', error);
        throw error;
    } finally {
        connection.release();  // Release the connection back to the pool
    }
}


export async function handleContactData(req: Request, res: Response) {
    const { type, locationId, contactId } = req.body;

    try {
        const connection = await pool.getConnection();

        if (type === 'ContactDelete') {
            await connection.execute(
                'DELETE FROM ghl_contacts WHERE ghl_contact_id = ?',
                [contactId]
            );
            res.send(`Contact with ID ${contactId} deleted successfully.`);
        } else if (type === 'ContactCreate' || type === 'ContactUpdate') {
            const options = {
                method: 'GET',
                url: `https://services.leadconnectorhq.com/contacts/${contactId}`,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${await fetchAuthTokenForLocation(locationId)}`,
                    'Version': '2021-07-28'
                },
            };

            const { data } = await axios.request(options);
            const { firstName, lastName, email, phone, tags, customFields, dateAdded, dateUpdated } = data.contact;

            const formattedDateAdded = dateAdded ? formatDateForMySQL(dateAdded) : null;
            const formattedDateUpdated = dateUpdated ? formatDateForMySQL(dateUpdated) : null;

            const customFieldMapping: { [key: string]: string } = {
                'e4gG3fbcG4ou9mfuHHZe': 'relationship1',
                '70F1oJwmm2TJU93Qiy3y': 'message',
                'mmYtpTLOEZZTZSZDKntX': 'driver_license_number',
                'fku6pc0H6egGLL1C5Lsc': 'sex',
                'MREglIwHcD6uNi2CCjX9': 'additional_info'
            };

            const customFieldsData: { [key: string]: any } = {};
            customFields.forEach((field: { id: string; value: any }) => {
                const dbFieldName = customFieldMapping[field.id];
                if (dbFieldName) {
                    customFieldsData[dbFieldName] = field.value || null;
                }
            });

            const sql = `
    INSERT INTO ghl_contacts (
        ghl_location_id, ghl_contact_id, fname, lname, email, phone, tags_list, 
        Relationship_1, Message, Driver_License_Number, Sex, Additional_Info, dateAdded, dateUpdated
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
        fname = VALUES(fname),
        lname = VALUES(lname),
        email = VALUES(email),
        phone = VALUES(phone),
        tags_list = VALUES(tags_list),
        Relationship_1 = VALUES(Relationship_1),
        Message = VALUES(Message),
        Driver_License_Number = VALUES(Driver_License_Number),
        Sex = VALUES(Sex),
        Additional_Info = VALUES(Additional_Info),
        dateAdded = VALUES(dateAdded),
        dateUpdated = VALUES(dateUpdated),
        updated_on = VALUES(updated_on);
`;

const values = [
    locationId,
    contactId,
    firstName,
    lastName,
    email,
    phone,
    JSON.stringify(tags),
    customFieldsData.relationship1 || null,
    customFieldsData.message || null,
    customFieldsData.driver_license_number || null,
    customFieldsData.sex || null,
    customFieldsData.additional_info || null,
    formattedDateAdded,
    formattedDateUpdated,
];

            await connection.execute(sql, values);
            res.send(`Contact with ID ${contactId} inserted/updated successfully.`);
        } else {
            res.status(400).send('Invalid type');
        }
    } catch (error) {
        console.error('Error handling contact data:', error);
        res.status(500).send('Internal Server Error');
    }
}

export function formatDateForMySQL(dateString: string): string {
    console.log("Original dateString:", dateString); // Debugging line

    const timestamp = dateString;
    const mysqlFormattedTimestamp = timestamp.replace('T', ' ').replace('Z', '');
    console.log(mysqlFormattedTimestamp); 
    return mysqlFormattedTimestamp
}








//opportunites

//initial calling function for entering the existing opportunities

export async function initialOpportunityFetchHtml(req:Request, res:Response){
    try {
        res.sendFile(path.join(__dirname, '../html', 'fetchExistingOpportunities.html'));
    } catch (error) {
        console.error('Error sending HTML file:', error);
        res.status(500).send('An error occurred');
    }
}

export async function initialOpportunityFetch(req:Request, res:Response){
    try {
        const { locationId } = req.body;
        

        const isFetched = await getInitialFetchState();
        if (isFetched) {
            res.send('Initial opportunities have already been fetched.');
            return;
        }

        initialOpportunityFetchMain(locationId)

    } catch (error) {
        res.status(500).send('An error occurred');
 
    }
}

async function getPipelineData(locationId: string) {
    try {
        const accessToken = await fetchAuthTokenForLocation(locationId);
        
        const options ={
            method: 'GET',
            url: 'https://services.leadconnectorhq.com/opportunities/pipelines',
            params: { locationId: 'mveip51Bg3251dh3H9aO' },
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`,
                'Version': '2021-07-28',
                'Accept': 'application/json'
            },
        };

        const { data } = await axios.request(options);
  const pipelines = data.pipelines;
// Find the pipeline where the name starts with 'Sales Pipeline'
const pipeline = pipelines.find((pipeline: any) => pipeline.name.startsWith('Sales Pipeline'));
      if (!pipeline) {
        throw new Error('Pipeline starting with "Sales Pipeline" not found');
      }
  
      return pipeline;
    } catch (error) {
      console.error('Error fetching pipeline data:', error);
      throw error;
    }
  }

  async function storeStagesAndCreateColumns(stages: any[]) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // Create stages table if not exists
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS stages (
                stage_id VARCHAR(255) PRIMARY KEY,
                stage_name VARCHAR(255) NOT NULL,
                position INT,
                id VARCHAR(255) NULL
            )
        `);

        // Store stages and create columns dynamically
        for (const stage of stages) {
            const { id, name, position } = stage;

            // Insert or update stage information in the stages table
            await connection.execute(`
                INSERT INTO stages (stage_id, stage_name, position, id)
                VALUES (?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    stage_name = VALUES(stage_name),
                    position = VALUES(position),
                    id = VALUES(id)
            `, [id, name, position, id]);

            // Sanitize and create column name
            const sanitizedColumnName = name.replace(/\W+/g, '_'); // Replace non-word characters with underscores
            const columnName = `stage_${sanitizedColumnName}`;

            // Check if the column already exists
            const [columns]: any[] = await connection.execute(
                `SHOW COLUMNS FROM opportunity_data LIKE ${mysql.escape(columnName)}`
            );

            if (columns.length === 0) {
                // Add column if it does not exist
                await connection.execute(`
                    ALTER TABLE opportunity_data
                    ADD COLUMN ${mysql.escapeId(columnName)} DATETIME
                `);
            }
        }

        await connection.commit();
    } catch (error) {
        await connection.rollback();
        console.error('Error storing stages and creating columns:', error);
        throw error;
    } finally {
        connection.release();
    }
}



// Main function to execute the steps
async function initialOpportunityFetchMain(locationId: string) {
    // Step 1: Get Opportunities
    const opportunities = await getOpportunities(locationId);

    // Step 2: Get Pipeline Data and Store Stages
    const pipelineData = await getPipelineData(locationId);
    await storeStagesAndCreateColumns(pipelineData.stages);

    // Step 3: Update opportunity_data table with contact info and stage timestamps
    await updateOpportunityData(opportunities,locationId);
}


  // Function to get opportunities with pagination support
async function getOpportunities(locationId: string, nextPageUrl: string | null = null): Promise<any[]> {
    let opportunities: any[] = [];
    
    try {
        const accessToken = await fetchAuthTokenForLocation(locationId);

        const options = {
            method: 'GET',
            url: nextPageUrl || 'https://services.leadconnectorhq.com/opportunities/search',
            params: nextPageUrl ? {} : {
                location_id: locationId,
                pipeline_id: process.env.PIPELINE_ID
            },
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`,
                'Version': '2021-07-28',
                'Accept': 'application/json'
            },
        };

        const { data } = await axios.request(options);
        opportunities = data.opportunities;

        // If nextPageUrl exists, fetch the next page
        if (data.meta.nextPageUrl) {
            const nextOpportunities = await getOpportunities(locationId, data.meta.nextPageUrl);
            opportunities = opportunities.concat(nextOpportunities);
        }

    } catch (error) {
        console.error('Error fetching opportunities:', error);
        throw error;
    }

    return opportunities;
}


async function updateOpportunityData(opportunities: any[], locationId: string) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        for (const opportunity of opportunities) {
            const { 
                id: opportunityId, 
                name: opportunity_name = null, 
                contact = {}, 
                pipelineStageId, 
                status = null, 
                monetaryValue = null, 
                source = null, 
                updatedAt, 
                assignedTo = null, 
                lastStatusChangeAt, 
                lastStageChangeAt, 
                createdAt 
            } = opportunity;

            const { 
                id: contactId = null, 
                name: contact_name = null, 
                email: contact_email = null, 
                phone: contact_phone  = null
            } = contact;

            // Check if assignedTo exists in the assigned_to table
            const [assignedToRows]: any[] = await connection.execute(`
                SELECT contact_name FROM assigned_to WHERE id = ?
            `, [assignedTo]);

            let assignedToName: string | null = null;

            // If assignedTo doesn't exist, fetch details from GHL API and insert into the assigned_to table
            if (assignedTo && assignedToRows.length === 0) {
                const options = {
                    method: 'GET',
                    url: `https://services.leadconnectorhq.com/users/${assignedTo}`,
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${await fetchAuthTokenForLocation(locationId)}`,
                        'Version': '2021-07-28'
                    }
                };

                const { data: assignedToData } = await axios.request(options);
                const { id, name, email, phone } = assignedToData;

                // Insert assignedTo data into the assigned_to table
                await connection.execute(`
                    INSERT INTO assigned_to (id, contact_name, contact_email, contact_phone)
                    VALUES (?, ?, ?, ?)
                 `, [id, name, email, phone]);

                assignedToName = name;
            } else {
                assignedToName = assignedToRows[0]?.contact_name ?? null;
            }

            // Format the datetime fields
            const formattedUpdatedAt = updatedAt ? formatDateForMySQL(updatedAt) : null;
            const formattedLastStatusChangeAt = lastStatusChangeAt ? formatDateForMySQL(lastStatusChangeAt) : null;
            const formattedLastStageChangeAt = lastStageChangeAt ? formatDateForMySQL(lastStageChangeAt) : null;
            const formattedCreatedAt = createdAt ? formatDateForMySQL(createdAt) : null;

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
                contactId, contact_name, contact_email, contact_phone, 
                opportunityId, opportunity_name, status, opportunity.pipelineId, 
                monetaryValue, source, formattedUpdatedAt, assignedToName, 
                formattedLastStatusChangeAt, formattedLastStageChangeAt, formattedCreatedAt
            ]);

            // Fetch the stage name using the pipelineStageId
            const [stageRows]: any[] = await connection.execute(`
                SELECT stage_name FROM stages WHERE stage_id = ?
            `, [pipelineStageId]);

            if (stageRows.length > 0) {
                const stageName = stageRows[0].stage_name;
                const sanitizedColumnName = `stage_${stageName.replace(/\W+/g, '_')}`;

                // Update opportunity_data table with the correct stage name and lastStageChangeAt
                await connection.execute(`
                    UPDATE opportunity_data
                    SET ${mysql.escapeId(sanitizedColumnName)} = ?
                    WHERE opportunity_id = ?
                `, [formattedLastStageChangeAt, opportunityId]);
            }
        }

        await connection.commit();
        await setInitialFetchState(true);
    } catch (error) {
        await connection.rollback();
        console.error('Error updating opportunity data:', error);
        throw error;
    } finally {
        connection.release();
    }
}




// Function to get the initial fetch state from the database
export async function getInitialFetchState(): Promise<boolean> {
    const connection = await pool.getConnection();
    try {
        const [rows]: any[] = await connection.execute('SELECT is_initial_fetch_done FROM fetch_state LIMIT 1');
        return rows.length > 0 && rows[0].is_initial_fetch_done === 1;
    } finally {
        connection.release();
    }
}

// Function to set the initial fetch state in the database
export async function setInitialFetchState(state: boolean): Promise<void> {
    const connection = await pool.getConnection();
    try {
        await connection.execute('INSERT INTO fetch_state (is_initial_fetch_done) VALUES (?) ON DUPLICATE KEY UPDATE is_initial_fetch_done = ?', [state ? 1 : 0, state ? 1 : 0]);
    } finally {
        connection.release();
    }
}






