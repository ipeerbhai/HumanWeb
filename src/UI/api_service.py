# api_service.py

from pydantic import BaseModel
import requests
import json
from scraping_utils import get_element_and_analyze
import asyncio
from typing import Dict, List
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse


BASE_URL = "http://localhost:8676"

class WebAutomationDSL:
    def __init__(self):
        self.uid = None
        self.variables = {}
        self.script = ""  
        self.current_line = 0  
        self.waiting_for_user = False  
        self.is_executing = False

    def execute_command(self, command, args):
        method = getattr(self, command.lower(), None)
        if method:
            return method(args)
        else:
            return f"Unknown command: {command}"

    def navigate(self, url):
        try:
            url = json.loads(url)
        except json.JSONDecodeError:
            pass

        endpoint = f"{BASE_URL}/v1/connectors/browser/navigate/"
        payload = {"url": url, "uid": self.uid if self.uid else "default"}
        response = requests.post(endpoint, json=payload)
        if response.status_code == 200:
            self.uid = payload["uid"]
            return f"Navigated to {url}"
        else:
            return f"Navigation failed: {response.status_code} - {response.text}"

    def read_xpath(self, xpath):
        if not self.uid:
            return "No active browser session. Navigate to a page first."
        endpoint = f"{BASE_URL}/v1/connectors/browser/FindDo/"
        payload = {"Search": xpath, "By": "xpath", "Action": "", "uid": self.uid}
        response = requests.post(endpoint, json=payload)
        if response.status_code == 200:
            return response.json().get("text", "Element found but no text content")
        else:
            return f"Failed to read xpath: {response.status_code} - {response.text}"

    def click_xpath(self, xpath):
        if not self.uid:
            return "No active browser session. Navigate to a page first."
        endpoint = f"{BASE_URL}/v1/connectors/browser/FindDo/"
        payload = {"Search": xpath, "By": "xpath", "Action": "click", "uid": self.uid}
        response = requests.post(endpoint, json=payload)
        if response.status_code == 200:
            return f"Clicked element at {xpath}"
        else:
            return f"Failed to click: {response.status_code} - {response.text}"

    def type_xpath(self, args):
        if not self.uid:
            return "No active browser session. Navigate to a page first."
        xpath, text = args.split('" "')
        xpath = xpath.strip('"')
        text = text.strip('"')
        text = self.resolve_variables(text)
        endpoint = f"{BASE_URL}/v1/connectors/browser/FindDo/"
        payload = {
            "Search": xpath,
            "By": "xpath",
            "Action": "fill",
            "Text": [text],
            "uid": self.uid,
        }
        response = requests.post(endpoint, json=payload)
        if response.status_code == 200:
            return f"Typed '{text}' into element at {xpath}"
        else:
            return f"Failed to type: {response.status_code} - {response.text}"

    def save_to_variable(self, args):
        variable_name, value = args.split(" ", 1)
        if value.startswith("READ_XPATH"):
            _, xpath = value.split(" ", 1)
            value = self.read_xpath(xpath.strip('"'))
        elif value.startswith("GENERATE_COMMENT"):
            _, context = value.split(" ", 1)
            context = self.resolve_variables(context)
            value = self.generate_comment(context)
        self.variables[variable_name] = value
        return f"Saved value to variable {variable_name}"

    def find_and_save(self, args):
        url, query, var_name = args.split('" "')
        url = url[1:]
        var_name = var_name[:-1]
        parsed_result = get_element_and_analyze(
            url, query.strip('"')
        )  # Replace with actual URL as needed

        # Assume result is a JSON string and parse it
        try:
            if parsed_result["found"] == 1:
                self.variables[var_name] = parsed_result["value"]
                return f"Saved '{parsed_result['value']}' to variable '{var_name}'"
            else:
                return f"Element not found for query: {query}"
        except json.JSONDecodeError:
            return f"Failed to parse response: {parsed_result}"

    def generate_comment(self, context):
        return f"This is a generated comment based on: {context[:50]}..."

    def resolve_variables(self, text):
        for var, value in self.variables.items():
            text = text.replace(f"${var}", str(value))
        return text

    def ask_user(self, prompt):
        return prompt

app = FastAPI()

dsl = WebAutomationDSL()

class ScriptModel(BaseModel):
    script: str

class CommandModel(BaseModel):
    command: str
    args: str

class StatusModel(BaseModel):
    current_line: int
    waiting_for_user: bool
    is_executing: bool

@app.get("/get_script")
async def get_script():
    return JSONResponse(content={"script": dsl.script})

@app.post("/update_script")
async def update_script(script_model: ScriptModel):
    dsl.script = script_model.script
    return JSONResponse(content={"message": "Script updated successfully"})

@app.post("/clear_script")
async def clear_script():
    dsl.script = ""
    dsl.current_line = 0
    dsl.waiting_for_user = False
    dsl.is_executing = False
    return JSONResponse(content={"message": "Script cleared successfully"})

@app.post("/execute_command")
async def execute_command(command_model: CommandModel):
    result = dsl.execute_command(command_model.command, command_model.args)
    return JSONResponse(content={"result": result})

@app.get("/get_variables")
async def get_variables():
    return JSONResponse(content=dsl.variables)

@app.get("/get_command_structure")
async def get_command_structure():
    return JSONResponse(content={
        "NAVIGATE": ["URL"],
        "ASK_USER": ["Prompt"],
        "CLICK_XPATH": ["XPath"],
        "TYPE_XPATH": ["XPath", "Text"],
        "SAVE_TO_VARIABLE": ["Variable Name", "Value"],
        "READ_XPATH": ["XPath"],
        "FIND_AND_SAVE": ["URL", "Query", "Variable Name"],
    })

@app.post("/add_command")
async def add_command(command_model: CommandModel):
    dsl.script += f"\n{command_model.command} {command_model.args}"
    return JSONResponse(content={"message": "Command added successfully"})

@app.get("/get_execution_status")
async def get_execution_status():
    return JSONResponse(content={
        "current_line": dsl.current_line,
        "waiting_for_user": dsl.waiting_for_user,
        "is_executing": dsl.is_executing
    })

@app.post("/set_execution_status")
async def set_execution_status(status: StatusModel):
    dsl.current_line = status.current_line
    dsl.waiting_for_user = status.waiting_for_user
    dsl.is_executing = status.is_executing
    return JSONResponse(content={"message": "Execution status updated successfully"})

@app.post("/execute_script")
async def execute_script():
    dsl.is_executing = True
    dsl.current_line = 0
    dsl.waiting_for_user = False
    lines = dsl.script.strip().split('\n')
    results = []

    while dsl.current_line < len(lines) and dsl.is_executing:
        line = lines[dsl.current_line].strip()
        if line:
            parts = line.split(" ", 1)
            command = parts[0]
            args = parts[1] if len(parts) > 1 else ""
            result = dsl.execute_command(command, args)
            results.append({"line": line, "result": result})
            if command == "ASK_USER":
                dsl.waiting_for_user = True
                return JSONResponse(content={
                    "results": results,
                    "waiting_for_user": True,
                    "user_prompt": args,
                    "script_completed": False
                })
        dsl.current_line += 1

    dsl.is_executing = False
    return JSONResponse(content={"results": results, "script_completed": True})

@app.post("/continue_execution")
async def continue_execution():
    if not dsl.waiting_for_user:
        return JSONResponse(content={"error": "Not waiting for user input"})
    
    dsl.waiting_for_user = False
    dsl.current_line += 1
    return await execute_script()

@app.post("/confirm_user_input")
async def confirm_user_input():
    if not dsl.waiting_for_user:
        return JSONResponse(content={"message": "Not waiting for user input."})

    dsl.waiting_for_user = False
    dsl.current_line += 1
    return JSONResponse(content={"message": "User input confirmed. Execution will continue."})

def main():
    default_url = "https://www.google.com"

    dsl.execute_command("navigate", default_url)
    
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8670)

if __name__ == "__main__":
    main()