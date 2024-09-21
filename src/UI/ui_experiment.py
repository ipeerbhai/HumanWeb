import streamlit as st
import requests
import time
import json

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
            # Try to decode the URL in case it's JSON-encoded
            url = json.loads(url)
        except json.JSONDecodeError:
            # If it's not JSON-encoded, use it as is
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
        payload = {
            "Search": xpath,
            "By": "xpath",
            "Action": "",
            "uid": self.uid
        }
        response = requests.post(endpoint, json=payload)
        if response.status_code == 200:
            return response.json().get("text", "Element found but no text content")
        else:
            return f"Failed to read xpath: {response.status_code} - {response.text}"

    def click_xpath(self, xpath):
        if not self.uid:
            return "No active browser session. Navigate to a page first."
        endpoint = f"{BASE_URL}/v1/connectors/browser/FindDo/"
        payload = {
            "Search": xpath,
            "By": "xpath",
            "Action": "click",
            "uid": self.uid
        }
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
            "uid": self.uid
        }
        response = requests.post(endpoint, json=payload)
        if response.status_code == 200:
            return f"Typed '{text}' into element at {xpath}"
        else:
            return f"Failed to type: {response.status_code} - {response.text}"

    def save_to_variable(self, args):
        variable_name, value = args.split(' ', 1)
        if value.startswith('READ_XPATH'):
            _, xpath = value.split(' ', 1)
            value = self.read_xpath(xpath.strip('"'))
        elif value.startswith('GENERATE_COMMENT'):
            _, context = value.split(' ', 1)
            context = self.resolve_variables(context)
            value = self.generate_comment(context)
        self.variables[variable_name] = value
        return f"Saved value to variable {variable_name}"

    def generate_comment(self, context):
        # Placeholder function - replace with actual AI model or API call
        return f"This is a generated comment based on: {context[:50]}..."

    def resolve_variables(self, text):
        for var, value in self.variables.items():
            text = text.replace(f'${var}', str(value))
        return text

    def ask_user(self, prompt):
        return prompt  # This will be handled in the Streamlit app

def main():
    st.title("Web Automation DSL")

    dsl = WebAutomationDSL()

    # Initialize session state
    if 'script' not in st.session_state:
        st.session_state.script = """
NAVIGATE https://www.linkedin.com
ASK_USER "Please log in to LinkedIn and click 'Confirm' when done."
CLICK_XPATH "//button[@aria-label='Search']"
TYPE_XPATH "//input[@aria-label='Search']" "Langchain"
SAVE_TO_VARIABLE post_content READ_XPATH "//div[@class='feed-shared-update-v2__description']"
CLICK_XPATH "//button[@aria-label='Comment']"
SAVE_TO_VARIABLE generated_comment GENERATE_COMMENT $post_content
TYPE_XPATH "//div[@aria-label='Add a comment']" "$generated_comment"
"""

    # Display and edit the script
    st.session_state.script = st.text_area("DSL Script", st.session_state.script, height=300)

    # Execute button
    if st.button("Execute Script"):
        lines = st.session_state.script.strip().split('\n')
        for line in lines:
            parts = line.strip().split(' ', 1)
            command = parts[0]
            args = parts[1] if len(parts) > 1 else ''
            
            if command == "ASK_USER":
                user_prompt = args.strip('"')
                user_action = st.empty()
                with user_action.container():
                    st.write(user_prompt)
                    if st.button("Confirm"):
                        user_action.empty()
                        st.write(f"User confirmed: {user_prompt}")
            else:
                result = dsl.execute_command(command, args)
                st.write(result)
            
            time.sleep(1)  # Small delay between commands

    # Define command structure
    command_structure = {
        "NAVIGATE": ["URL"],
        "ASK_USER": ["Prompt"],
        "CLICK_XPATH": ["XPath"],
        "TYPE_XPATH": ["XPath", "Text"],
        "SAVE_TO_VARIABLE": ["Variable Name", "Value"],
        "READ_XPATH": ["XPath"],
    }

    # Command addition section
    st.subheader("Add New Command")
    selected_command = st.selectbox("Select Command", list(command_structure.keys()))
    
    # Dynamic input fields based on selected command
    input_values = {}
    for arg in command_structure[selected_command]:
        input_values[arg] = st.text_input(f"Enter {arg}")

    if st.button("Add Command"):
        if selected_command == "TYPE_XPATH":
            new_command = f'{selected_command} {json.dumps(input_values["XPath"])} {json.dumps(input_values["Text"])}'
        elif selected_command == "SAVE_TO_VARIABLE":
            new_command = f'{selected_command} {input_values["Variable Name"]} {json.dumps(input_values["Value"])}'
        else:
            new_command = f'{selected_command} {json.dumps(input_values[command_structure[selected_command][0]])}'
        
        st.session_state.script += f"\n{new_command}"
        st.rerun()

if __name__ == "__main__":
    main()