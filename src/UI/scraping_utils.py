import os
import json
from dotenv import load_dotenv
from anthropic import Anthropic
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.common.exceptions import NoSuchElementException


load_dotenv()

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

        # Parse the JSON response
        response = json.loads(message.content[0].text)

        if response['found'] == 1:
            # Map the attribute to Selenium's By class
            attribute_map = {
                'NAME': By.NAME,
                'ID': By.ID,
                'LINK_TEXT': By.LINK_TEXT,
                'CLASS_NAME': By.CLASS_NAME
            }

            by_strategy = attribute_map.get(response['attribute'])
            if by_strategy:
                try:
                    element = driver.find_element(by_strategy, response['value'])
                    return {"found": 1, "value": element}
                except NoSuchElementException:
                    return {"found": 0, "message": "Element not found"}
            else:
                return {"found": 0, "message": f"Unsupported attribute: {response['attribute']}"}
        else:
            return {"found": 0, "message": "Element not found"}

    except Exception as e:
        return {"found": 0, "message": "Error occurred"}

    finally:
        driver.quit()