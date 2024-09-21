import requests
import json
import time

class BrowserClient:
    def __init__(self, base_url="http://localhost:8676"):
        self.base_url = base_url
        self.uid = None

    def navigate(self, url):
        endpoint = f"{self.base_url}/v1/connectors/browser/navigate/"
        payload = {
            "url": url,
            "uid": self.uid if self.uid else "default"
        }
        response = requests.post(endpoint, json=payload)
        if response.status_code == 200:
            data = response.json()
            self.uid = payload["uid"]
            return data["source"]
        else:
            raise Exception(f"Navigation failed: {response.status_code} - {response.text}")

    def get_source(self):
        if not self.uid:
            raise Exception("No active browser session. Navigate to a page first.")
        endpoint = f"{self.base_url}/v1/connectors/browser/source/{self.uid}"
        response = requests.get(endpoint)
        if response.status_code == 200:
            return response.json()["source"]
        else:
            raise Exception(f"Failed to get source: {response.status_code} - {response.text}")

    def get_human_readable_content(self):
        if not self.uid:
            raise Exception("No active browser session. Navigate to a page first.")
        endpoint = f"{self.base_url}/v1/connectors/browser/human_source/{self.uid}"
        response = requests.get(endpoint)
        if response.status_code == 200:
            return response.json()["source"]
        else:
            raise Exception(f"Failed to get human readable content: {response.status_code} - {response.text}")

    def find_and_do_action(self, search, by, action, text=None):
        if not self.uid:
            raise Exception("No active browser session. Navigate to a page first.")
        endpoint = f"{self.base_url}/v1/connectors/browser/FindDo/"
        payload = {
            "Search": search,
            "By": by,
            "Action": action,
            "Text": text if text else [],
            "uid": self.uid
        }
        response = requests.post(endpoint, json=payload)
        if response.status_code != 200:
            raise Exception(f"Action failed: {response.status_code} - {response.text}")

# Usage example
if __name__ == "__main__":
    client = BrowserClient()
    
    # Navigate to LinkedIn
    source = client.navigate("https://www.linkedin.com")
    print("Navigated to LinkedIn")

    # Wait for page to load (you might need to adjust this)
    time.sleep(5)

    # Get the human-readable content
    content = client.get_human_readable_content()
    print("LinkedIn page content:")
    print(content[:500])  # Print first 500 characters

    # Example: Click on the "Sign in" button (you might need to adjust the selector)
    client.find_and_do_action("sign-in-form__submit-button", "id", "click")
    print("Clicked on Sign in button")

    # Wait for the next page to load
    time.sleep(3)

    # Get the updated content
    updated_content = client.get_human_readable_content()
    print("Updated content after clicking Sign in:")
    print(updated_content[:500])  # Print first 500 characters