import React, { useState } from "react";

const UrlScraper = () => {
  const [url, setUrl] = useState("");
  const [returnCommand, setReturnCommand] = useState("");

  const handleUrlChange = (event) => {
    setUrl(event.target.value);
  };

  const handleReturnCommandChange = (event) => {
    setReturnCommand(event.target.value);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    try {
      const response = await fetch("http://localhost:8000/scrape", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url, returnCommand }),
      });

      if (response.ok) {
        console.log("Scraping started!");
      } else {
        console.error("Failed to start scraping.");
      }
    } catch (error) {
      console.error("Error:", error);
    }
  };

  return (
    <div style={{ padding: "20px", maxWidth: "400px", margin: "auto" }}>
      <h2>URL Scraper</h2>
      <form onSubmit={handleSubmit}>
        <input
          type="url"
          placeholder="Enter website URL"
          value={url}
          onChange={handleUrlChange}
          style={{ width: "100%", padding: "10px", marginBottom: "10px" }}
          required
        />
        <input
          type="text"
          placeholder="Enter return command"
          value={returnCommand}
          onChange={handleReturnCommandChange}
          style={{ width: "100%", padding: "10px", marginBottom: "10px" }}
          required
        />
        <button type="submit" style={{ padding: "10px", width: "100%" }}>
          Scrape URL
        </button>
      </form>
    </div>
  );
};

export default UrlScraper;
