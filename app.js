require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { WebClient } = require('@slack/web-api');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;
const slackToken = process.env.SLACK_BOT_TOKEN;
const slackClient = new WebClient(slackToken);
const jiraBaseUrl = process.env.JIRA_BASE_URL;
const jiraUserEmail = process.env.JIRA_USER_EMAIL;
const jiraApiToken = process.env.JIRA_API_TOKEN;
app.use(bodyParser.json());
let slackToJira = {};
// Function to add comment to JIRA issue
const addCommentToJira = async (issueKey, comment) => {
    try {
        let resposne = await axios.post(`${jiraBaseUrl}/rest/api/2/issue/${issueKey}/comment`, {
            body: comment
        }, {
            auth: {
                username: jiraUserEmail,
                password: jiraApiToken
            }
        });
        console.log(`Comment added to JIRA issue ${issueKey}: ${comment}`);
    } catch (error) {
        console.error('Error adding comment to JIRA:', error);
    }
};
// Endpoint to handle Slack events
app.post('/slack/events', async (req, res) => {
    console.log(`slack/events`,req.body);
    const { type, challenge, event } = req.body;
    if (type === 'url_verification') {
        res.status(200).send({ challenge });
        return;
    }
    if (event && event.type === 'message' && !event.bot_id) {
        const messageText = event.text;
        const channelId = event.channel;
        const threadTs = event.thread_ts || event.ts;
        if (event.thread_ts) {
            // Add comment to JIRA issue
            const issueKey = slackToJira[threadTs];
            if (issueKey) {
                await addCommentToJira(issueKey, messageText);
            }
        } else {
            // Create a new JIRA issue
            try {
                const response = await axios.post(`${jiraBaseUrl}/rest/api/2/issue`, {
                    fields: {
                        project: {
                            key: process.env.PROJECT_KEY
                        },
                        summary: messageText,
                        description: messageText,
                        issuetype: {
                            name: "Task"
                        }
                    }
                }, {
                    auth: {
                        username: jiraUserEmail,
                        password: jiraApiToken
                    }
                });
                const issueKey = response.data.key;
                const issueUrl = `${jiraBaseUrl}/browse/${issueKey}`;
                // Notify the Slack channel about the new JIRA issue
                const slackResponse = await slackClient.chat.postMessage({
                    channel: channelId,
                    text: `New JIRA issue created: <${issueUrl}|${issueKey}>`,
                    thread_ts: threadTs
                });
                // Store the mapping of Slack thread to JIRA issue
                slackToJira[slackResponse.ts] = issueKey;
                console.log(`JIRA issue created: ${issueKey}`);
                res.status(200).send('OK');
            } catch (error) {
                console.error('Error creating JIRA issue:', error);
                res.status(500).send('Error');
            }
        }
    } else {
        res.status(200).send('Event received');
    }
});
// Endpoint to handle JIRA webhooks
app.post('/jira-webhook', async (req, res) => {
    const jiraEvent = req.body;
    console.log(`jira-webhook`,jiraEvent);
    // Handle new comment added to JIRA issue
    if (jiraEvent.webhookEvent === 'comment_created') {
        const issueKey = jiraEvent.issue.key;
        const commentBody = jiraEvent.comment.body;
        // Find the Slack thread associated with this JIRA issue
        for (const [slackTs, jiraIssueKey] of Object.entries(slackToJira)) {
            if (jiraIssueKey === issueKey) {
                try {
                    await slackClient.chat.postMessage({
                        channel: process.env.SLACK_CHANNEL_ID,
                        text: `New comment on JIRA issue ${issueKey}: ${commentBody}`,
                        thread_ts: slackTs
                    });
                } catch (error) {
                    console.error('Error posting to Slack:', error);
                }
                break;
            }
        }
    }
    res.status(200).send('OK');
});
// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});