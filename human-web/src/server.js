const express = require("express");
const cors = require("cors");
require("dotenv").config();
const bodyParser = require("body-parser");
const { Builder } = require("selenium-webdriver");
const { Anthropic } = require("@anthropic-ai/sdk");
const fs = require("fs");
const {
  CopilotRuntime,
  AnthropicAdapter,
  copilotRuntimeNodeHttpEndpoint,
} = require("@copilotkit/runtime");
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
    const prompt = `Find the element that matches with the query. Query: ${returnCommand}. Find the element in the html: ${await driver.getPageSource()}  Return a JSON object with the keys 'found' (should be 1 if the element is found, 0 otherwise), 'value' (containing the value of the NAME, ID, LINK_TEXT, or CLASS_NAME of the element), and 'attribute' (containing NAME, ID, LINK_TEXT, CLASS_NAME).`;

    fs.writeFile("Output.txt", prompt, (err) => {
      if (err) throw err;
    });

    const response = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20240620",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });
    console.log("resss", response);
    res.status(200).send(response);
  } catch (error) {
    console.error(error);
    res.status(500).send("Error occurred while scraping.");
    await driver.quit();
  }
});

app.use("/api/copilotkit", (req, res, next) => {
  const serviceAdapter = new AnthropicAdapter({ anthropic });
  const runtime = new CopilotRuntime();
  const handler = copilotRuntimeNodeHttpEndpoint({
    endpoint: "/api/copilotkit",
    runtime,
    serviceAdapter,
  });

  return handler(req, res, next);
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
