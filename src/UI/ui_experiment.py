import streamlit as st
import requests
import time
import json
import base64
from scraping_utils import get_element_and_analyze

BASE_URL = "http://localhost:8676"

class WebAutomationDSL:
    def __init__(self):
        self.uid = None
        self.variables = {}

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
            self.uid = "default"
        endpoint = f"{BASE_URL}/v1/connectors/browser/FindDo/"
        payload = {
            "Search": xpath,
            "By": "xpath",
            "Action": "click",
            "Text": "",
            "uid": self.uid,
        }
        response = requests.post(endpoint, json=payload)
        if response.status_code == 200:
            return f"Clicked element at {xpath}"
        else:
            return f"Failed to click: {response.status_code} - {response.text}"

    def type_xpath(self, args):
        if not self.uid:
            self.uid = "default"
        xpath, text = args.split('" "')
        xpath = xpath.strip('"')
        text = text.strip('"')
        text = self.resolve_variables(text)
        endpoint = f"{BASE_URL}/v1/connectors/browser/FindDo/"
        payload = {
            "Search": xpath,
            "By": "xpath",
            "Action": "fill",
            "Text": text,
            "uid": self.uid,
        }
        response = requests.post(endpoint, json=payload)
        if response.status_code == 200:
            return f"Typed '{text}' into element at {xpath}"
        else:
            return f"Failed to type: {response.status_code} - {response.text}"

    def click_tagged(self, tagged_name):
        if not self.uid:
            return "No active browser session. Navigate to a page first."
        endpoint = f"{BASE_URL}/v1/connectors/browser/tagged_element_action/"
        payload = {"tagged_name": tagged_name, "action": "click", "uid": self.uid}
        response = requests.post(endpoint, json=payload)
        if response.status_code == 200:
            return f"Clicked tagged element: {tagged_name}"
        elif response.status_code == 404:
            return f"Tagged element not found: {tagged_name}"
        else:
            return f"Failed to click tagged element: {response.status_code} - {response.text}"

    def type_tagged(self, args):
        if not self.uid:
            return "No active browser session. Navigate to a page first."
        tagged_name, text = args.split('" "')
        tagged_name = tagged_name.strip('"')
        text = text.strip('"')
        text = self.resolve_variables(text)
        endpoint = f"{BASE_URL}/v1/connectors/browser/tagged_element_action/"
        payload = {"tagged_name": tagged_name, "action": "fill", "text": text, "uid": self.uid}
        response = requests.post(endpoint, json=payload)
        if response.status_code == 200:
            return f"Typed '{text}' into tagged element: {tagged_name}"
        elif response.status_code == 404:
            return f"Tagged element not found: {tagged_name}"
        else:
            return f"Failed to type into tagged element: {response.status_code} - {response.text}"

    def read_tagged(self, tagged_name):
        if not self.uid:
            return "No active browser session. Navigate to a page first."
        endpoint = f"{BASE_URL}/v1/connectors/browser/tagged_element_action/"
        payload = {"tagged_name": tagged_name, "action": "read", "uid": self.uid}
        response = requests.post(endpoint, json=payload)
        if response.status_code == 200:
            return response.json().get("content", "Tagged element found but no text content")
        elif response.status_code == 404:
            return f"Tagged element not found: {tagged_name}"
        else:
            return f"Failed to read tagged element: {response.status_code} - {response.text}"

    def press_key_tagged(self, args):
        if not self.uid:
            return "No active browser session. Navigate to a page first."
        tagged_name, key = args.split('" "')
        tagged_name = tagged_name.strip('"')
        key = key.strip('"').lower()
        endpoint = f"{BASE_URL}/v1/connectors/browser/press_key_tagged/"
        payload = {"tagged_name": tagged_name, "action": key, "uid": self.uid}
        response = requests.post(endpoint, json=payload)
        if response.status_code == 200:
            return f"Pressed {key} key on tagged element: {tagged_name}"
        elif response.status_code == 404:
            return f"Tagged element not found: {tagged_name}"
        else:
            return f"Failed to press key on tagged element: {response.status_code} - {response.text}"

    def save_to_variable(self, args):
        variable_name, value = args.split(" ", 1)
        if value.startswith("READ_XPATH"):
            _, xpath = value.split(" ", 1)
            value = self.read_xpath(xpath.strip('"'))
        elif value.startswith("READ_TAGGED"):
            _, tagged_name = value.split(" ", 1)
            value = self.read_tagged(tagged_name.strip('"'))
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
        parsed_result = get_element_and_analyze(url, query.strip('"'))
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

def fetch_tagged_elements():
    endpoint = f"{BASE_URL}/v1/connectors/browser/get_all_selected_elements/"
    response = requests.get(endpoint)
    if response.status_code == 200:
        return response.json().get("elements", [])
    else:
        return []

def take_screenshot(uid):
    endpoint = f"{BASE_URL}/v1/connectors/browser/screenshot/{uid}"
    response = requests.get(endpoint)
    if response.status_code == 200:
        return base64.b64encode(response.content).decode()
    else:
        return None

def main():
    st.title("Web Automation DSL")

    # Initialize dsl in session state if it doesn't exist
    if 'dsl' not in st.session_state:
        st.session_state.dsl = WebAutomationDSL()

    # Initialize session state
    if "script" not in st.session_state:
        st.session_state.script = """
NAVIGATE https://www.linkedin.com
ASK_USER "Please log in to LinkedIn and click 'Confirm' when done."
TYPE_XPATH "//input[@aria-label='Search']" "Langchain"
SAVE_TO_VARIABLE post_content READ_XPATH "//div[@class='feed-shared-update-v2__description']"
CLICK_XPATH "//button[@aria-label='Comment']"
SAVE_TO_VARIABLE generated_comment GENERATE_COMMENT $post_content
TYPE_XPATH "//div[@aria-label='Add a comment']" "$generated_comment"
"""
    if "current_line" not in st.session_state:
        st.session_state.current_line = 0
    if "waiting_for_user" not in st.session_state:
        st.session_state.waiting_for_user = False
    if "is_executing" not in st.session_state:
        st.session_state.is_executing = False

    # Sidebar with tagged elements
    st.sidebar.title("Tagged Elements")
    tagged_elements = fetch_tagged_elements()
    for element in tagged_elements:
        st.sidebar.text(f"{element['tagged_name']}: {element['html'][:50]}...")

    # Display and edit the script
    st.session_state.script = st.text_area("DSL Script", st.session_state.script, height=300)

    # Create columns for buttons
    col1, col2, col3, col4 = st.columns(4)

    with col1:
        if st.button("Execute Script"):
            st.session_state.current_line = 0
            st.session_state.waiting_for_user = False
            st.session_state.is_executing = True
            st.rerun()

    with col2:
        if st.button("Step Through"):
            if not st.session_state.is_executing:
                st.session_state.current_line = 0
                st.session_state.waiting_for_user = False
                st.session_state.is_executing = True
            if st.session_state.current_line < len(st.session_state.script.strip().split("\n")):
                st.session_state.current_line += 1
            st.rerun()

    with col3:
        if st.button("Clear Script"):
            st.session_state.script = ""
            st.session_state.current_line = 0
            st.session_state.waiting_for_user = False
            st.session_state.is_executing = False
            st.rerun()

    with col4:
        if st.button("Take Screenshot"):
            if st.session_state.dsl.uid:
                screenshot = take_screenshot(st.session_state.dsl.uid)
                if screenshot:
                    st.image(screenshot)
                else:
                    st.error("Failed to take screenshot")
            else:
                st.error("No active browser session")

    # Script execution
    if st.session_state.is_executing:
        lines = st.session_state.script.strip().split("\n")
        while st.session_state.current_line < len(lines):
            line = lines[st.session_state.current_line].strip()
            if not line:
                st.session_state.current_line += 1
                continue
            parts = line.split(" ", 1)
            command = parts[0]
            args = parts[1] if len(parts) > 1 else ""

            st.text(f"Executing: {line}")

            if command == "ASK_USER":
                user_prompt = args.strip('"')
                st.write(user_prompt)
                if st.button("Confirm", key=f"confirm_{st.session_state.current_line}"):
                    st.session_state.waiting_for_user = False
                    st.session_state.current_line += 1
                    st.rerun()
                else:
                    st.session_state.waiting_for_user = True
                break
            else:
                result = st.session_state.dsl.execute_command(command, args)
                st.write(result)
                st.session_state.current_line += 1

            time.sleep(1)

        # Reset execution if script is completed
        if st.session_state.current_line >= len(lines):
            st.session_state.current_line = 0
            st.session_state.waiting_for_user = False
            st.session_state.is_executing = False

    # Display variables
    st.subheader("Variables")
    for var, value in st.session_state.dsl.variables.items():
        st.text(f"{var}: {value}")

    # Define command structure
    command_structure = {
        "NAVIGATE": ["URL"],
        "ASK_USER": ["Prompt"],
        "CLICK_XPATH": ["XPath"],
        "CLICK_TAGGED": ["Tagged Name"],
        "TYPE_XPATH": ["XPath", "Text"],
        "TYPE_TAGGED": ["Tagged Name", "Text"],
        "SAVE_TO_VARIABLE": ["Variable Name", "Value"],
        "READ_XPATH": ["XPath"],
        "READ_TAGGED": ["Tagged Name"],
        "FIND_AND_SAVE": ["URL", "Query", "Variable Name"],
        "PRESS_KEY_TAGGED": ["Tagged Name", "Key"],
    }

    # Command addition section
    st.subheader("Add New Command")
    selected_command = st.selectbox("Select Command", list(command_structure.keys()))

    # Dynamic input fields based on selected command
    input_values = {}
    for arg in command_structure[selected_command]:
        if arg == "Tagged Name" and tagged_elements:
            input_values[arg] = st.selectbox(f"Select {arg}", [e['tagged_name'] for e in tagged_elements])
        else:
            input_values[arg] = st.text_input(f"Enter {arg}", key=f"{selected_command}_{arg}")

    if st.button("Add Command", key="add_command"):
        if selected_command in ["TYPE_XPATH", "TYPE_TAGGED", "PRESS_KEY_TAGGED"]:
            new_command = f'{selected_command} "{input_values[command_structure[selected_command][0]]}" "{input_values[command_structure[selected_command][1]]}"'
        elif selected_command == "SAVE_TO_VARIABLE":
            new_command = f'{selected_command} {input_values["Variable Name"]} {input_values["Value"]}'
        elif selected_command == "FIND_AND_SAVE":
            new_command = f'{selected_command} "{input_values["URL"]}" "{input_values["Query"]}" "{input_values["Variable Name"]}"'
        else:
            new_command = f'{selected_command} "{input_values[command_structure[selected_command][0]]}"'

        st.session_state.script += f"\n{new_command}"
        st.rerun()

    # Save/Load script
    st.subheader("Save/Load Script")
    col1, col2 = st.columns(2)
    with col1:
        script_name = st.text_input("Script Name")
        if st.button("Save Script"):
            with open(f"{script_name}.txt", "w") as f:
                f.write(st.session_state.script)
            st.success(f"Script saved as {script_name}.txt")
    with col2:
        uploaded_file = st.file_uploader("Load Script", type="txt")
        if uploaded_file is not None:
            st.session_state.script = uploaded_file.getvalue().decode()
            st.rerun()

if __name__ == "__main__":
    main()