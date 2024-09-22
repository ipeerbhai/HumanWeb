from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support import expected_conditions as EC
from anthropic import Anthropic, HUMAN_PROMPT, AI_PROMPT
import os
import json

# Initialize Anthropic client
anthropic = Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

# Set up Chrome options
chrome_options = Options()
chrome_options.add_argument("--headless")
driver = webdriver.Chrome(options=chrome_options)

def get_element_and_analyze(url, query):
    try:
        # Navigate to the URL
        driver.get(url)

        # Use Anthropic to analyze the content
        prompt = f"Find the element that matches with the query. Query: {query}. Find the element in the html: {driver.page_source}  Return a JSON object with the keys 'found' (should be 1 if the element is found, 0 otherwise), 'value' (containing the value of the NAME, ID, LINK_TEXT, or CLASS_NAME of the element), and 'attribute' (containing NAME, ID, LINK_TEXT, CLASS_NAME)."
        
        message = anthropic.messages.create(
            model="claude-3-5-sonnet-20240620",
            max_tokens=8192,
            messages=[{"role": "user", "content": prompt}]
        )

        return message.content

    except Exception as e:
        return f"An error occurred: {str(e)}"

    finally:
        driver.quit()

# Example usage
url = "https://www.google.com"
query = "search input"  # CSS selector for the element you want to find

result = get_element_and_analyze(url, query)
print("Result: ", result)
parsed_data = json.loads(result[0].text)
print("Parsed JSON: ", parsed_data)