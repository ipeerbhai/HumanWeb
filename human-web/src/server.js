const express = require("express");
const cors = require("cors");
require("dotenv").config();
const bodyParser = require("body-parser");
const { Builder } = require("selenium-webdriver");
const { Anthropic } = require("@anthropic-ai/sdk");
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const app = express();
const PORT = 8000;

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cors());

// Scrape endpoint
app.post("/scrape", async (req, res) => {
  const { url, returnCommand } = req.body;

  const driver = new Builder().forBrowser("chrome").build();

  try {
    await driver.get(url);
    console.log(`Opened ${url}.`);
    console.log(`Waiting for command: "${returnCommand}"`);

    // Wait for the specified return command
    process.stdin.once("data", (data) => {
      const command = data.toString().trim();
      if (command === returnCommand) {
        console.log(`Received command to return: "${command}"`);
        res.send("Scraping completed or closed.");
        driver.quit();
      } else {
        console.log(`Unrecognized command: "${command}"`);
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Error occurred while scraping.");
    await driver.quit();
  }
});

app.post("/api/copilotkit", async (req, res) => {
  try {
    const { messages } = req.body;

    const response = await anthropic.messages.create({
      model: "claude-3-opus-20240229",
      max_tokens: 1000,
      messages: messages,
    });

    res.json({ response: response.content[0].text });
  } catch (error) {
    console.error("Error:", error);
    res
      .status(500)
      .json({ error: "An error occurred while processing your request." });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
