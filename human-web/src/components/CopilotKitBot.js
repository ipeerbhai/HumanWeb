import React, { useState } from "react";
import axios from "axios";

const CopilotKit = () => {
  const [input, setInput] = useState("");
  const [response, setResponse] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const result = await axios.post("http://localhost:8000/api/copilotkit", {
        messages: [{ role: "user", content: input }],
      });
      setResponse(result.data.response);
    } catch (error) {
      console.error("Error:", error);
      setResponse("An error occurred while processing your request.");
    }
  };

  return (
    <div className="p-4">
      <form onSubmit={handleSubmit} className="mb-4">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="w-full p-2 border rounded"
          placeholder="Enter your message"
        />
        <button
          type="submit"
          className="mt-2 p-2 bg-blue-500 text-white rounded"
        >
          Send
        </button>
      </form>
      {response && (
        <div className="mt-4 p-4 border rounded">
          <h2 className="font-bold mb-2">Response:</h2>
          <p>{response}</p>
        </div>
      )}
    </div>
  );
};

export default CopilotKit;
