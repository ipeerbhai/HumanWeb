from typing import Dict, List
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from io import BytesIO
from pydantic import BaseModel
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.common.exceptions import WebDriverException, NoSuchElementException
from bs4 import BeautifulSoup, Comment

app = FastAPI()

# Initialize Firefox browser and set it to fullscreen
firefox_options = webdriver.FirefoxOptions()
firefox_options.add_argument("--start-fullscreen")
browsers = {}  # a dictionary holding uid -> selenium.driver instances
selected_elements: List[Dict[str, str]] = []

class NavigateDetails(BaseModel):
    url: str
    uid: str

class ElementActions(BaseModel):
    Search: str
    By: str
    Action: str
    Text: List[str] | None = []
    uid: str

class SelectedElement(BaseModel):
    element_html: str
    tagged_name: str | None = None

class TaggedElementAction(BaseModel):
    tagged_name: str
    action: str
    text: str | None = None
    uid: str

def find_tagged_element(tagged_name: str, uid: str):
    """
    Find a tagged element by its name using the element's ID, handling quoted and unquoted names.
    
    :param tagged_name: The name of the tagged element to find
    :param uid: The unique identifier for the browser instance
    :return: The found element or None if not found
    """
    # Remove any surrounding quotes and strip whitespace
    cleaned_name = tagged_name.strip().strip('"\'')
    
    for element in selected_elements:
        # Clean the stored tagged_name as well
        stored_name = element["tagged_name"].strip().strip('"\'')
        
        if stored_name == cleaned_name:
            browser = browsers.get(uid)
            if browser:
                # Parse the HTML to find the ID
                soup = BeautifulSoup(element["html"], 'html.parser')
                tag = soup.find()
                if tag.get('id'):
                    try:
                        return browser.find_element(By.ID, tag['id'])
                    except NoSuchElementException:
                        # If the element is not found, return None
                        return None
    return None

@app.get("/")
def read_root():
    """Root endpoint returning a simple greeting."""
    return {"Hello": "World"}

@app.post("/v1/connectors/browser/update_selected_element/")
async def update_selected_element(element: SelectedElement):
    """
    Update the list of selected elements with a new tagged element.
    
    :param element: The SelectedElement object containing the element details
    :return: A status message indicating success
    """
    global selected_elements
    # Strip quotes and whitespace from the tagged_name before storing
    cleaned_name = element.tagged_name.strip().strip('"\'')
    selected_elements.append({"tagged_name": cleaned_name, "html": element.element_html})
    return {"status": "success"}

@app.get("/v1/connectors/browser/get_last_selected_element/")
async def get_last_selected_element():
    """
    Retrieve the last selected element.
    
    :return: The last selected element or an error if no elements have been selected
    """
    if selected_elements:
        return {"element": selected_elements[-1]}
    else:
        raise HTTPException(status_code=404, detail="No element has been selected yet")

@app.get("/v1/connectors/browser/get_all_selected_elements/")
async def get_all_selected_elements():
    """
    Retrieve all selected elements.
    
    :return: A list of all selected elements or an error if no elements have been selected
    """
    if selected_elements:
        return {"elements": selected_elements}
    else:
        raise HTTPException(status_code=404, detail="No elements have been selected yet")

@app.get("/v1/connectors/browser/get_element_by_name/{tagged_name}")
async def get_element_by_name(tagged_name: str):
    """
    Retrieve a selected element by its tagged name.
    
    :param tagged_name: The name of the tagged element to retrieve
    :return: The element with the specified name or an error if not found
    """
    cleaned_name = tagged_name.strip().strip('"\'')
    for element in selected_elements:
        if element["tagged_name"].strip().strip('"\'') == cleaned_name:
            return {"element": element}
    raise HTTPException(status_code=404, detail=f"No element found with name: {tagged_name}")

@app.get("/v1/connectors/browser/clear_selected_elements/")
async def clear_selected_elements():
    """
    Clear all selected elements.
    
    :return: A status message indicating success
    """
    global selected_elements
    selected_elements = []
    return {"status": "success"}

@app.post("/v1/connectors/browser/navigate/")
async def navigate(details: NavigateDetails):
    """
    Navigate to a specified URL in the browser.
    
    :param details: NavigateDetails object containing the URL and browser UID
    :return: The page source of the navigated page or an error if navigation fails
    """
    browser = None
    if details.uid in browsers:
        browser = browsers[details.uid]
    else:
        browser = webdriver.Firefox(options=firefox_options)
        browsers[details.uid] = browser
    try:
        browser.get(details.url)
        source = browser.page_source
        return {"source": source}
    except WebDriverException as e:
        if "invalid session id" in str(e):
            browser = webdriver.Firefox(options=firefox_options)
            browser.get(details.url)
            source = browser.page_source
            return {"source": source}
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/v1/connectors/browser/FindDo/")
async def find_and_do_action(element_details: ElementActions):
    """
    Find an element and perform an action on it.
    
    :param element_details: ElementActions object containing search criteria and action details
    :return: A success message or an error if the action fails
    """
    browser = None
    if element_details.uid in browsers:
        browser = browsers[element_details.uid]
    try:
        field_search = None
        match element_details.By:
            case 'id':
                field_search = By.ID
            case 'xpath':
                field_search = By.XPATH

        field = browser.find_element(field_search, element_details.Search)
            
        if element_details.Action == "click":
            field.click()
        elif element_details.Action == "fill":
            for line in element_details.Text:
                field.send_keys(line)
        return {"status": "success"}
    except WebDriverException as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/v1/connectors/browser/tagged_element_action/")
async def tagged_element_action(action_details: TaggedElementAction):
    """
    Perform an action on a tagged element.
    
    :param action_details: TaggedElementAction object containing the tagged element name and action details
    :return: A success message or an error if the action fails
    """
    browser = browsers.get(action_details.uid)
    if not browser:
        raise HTTPException(status_code=404, detail="Browser instance not found")
    
    element = find_tagged_element(action_details.tagged_name, action_details.uid)
    if not element:
        raise HTTPException(status_code=404, detail=f"Tagged element '{action_details.tagged_name}' not found")
    
    try:
        if action_details.action == "click":
            element.click()
        elif action_details.action == "fill":
            element.clear()
            element.send_keys(action_details.text)
        elif action_details.action == "read":
            return {"content": element.text}
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported action: {action_details.action}")
        
        return {"status": "success"}
    except WebDriverException as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/v1/connectors/browser/press_key_tagged/")
async def press_key_tagged(tagged_name: str, key: str, uid: str):
    """
    Press a specified key on a tagged element.
    
    :param tagged_name: The name of the tagged element
    :param key: The key to press (e.g., "enter", "escape")
    :param uid: The unique identifier for the browser instance
    :return: A success message or an error if the action fails
    """
    element = find_tagged_element(tagged_name, uid)
    if not element:
        raise HTTPException(status_code=404, detail=f"Tagged element '{tagged_name}' not found")
    
    try:
        if key.lower() == "enter":
            element.send_keys(Keys.ENTER)
        elif key.lower() == "escape":
            element.send_keys(Keys.ESCAPE)
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported key: {key}")
        
        return {"status": "success"}
    except WebDriverException as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/v1/connectors/browser/source/{uid}")
async def get_page_source(uid: str):
    """
    Get the page source for a specific browser instance.
    
    :param uid: The unique identifier for the browser instance
    :return: The page source or an error if the browser instance is not found
    """
    browser = browsers.get(uid)
    if not browser:
        raise HTTPException(status_code=404, detail="Browser instance not found")
    try:
        source = browser.page_source
        return {"source": source}
    except WebDriverException as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/v1/connectors/browser/screenshot/{uid}")
async def get_screenshot(uid: str):
    """
    Take a screenshot of the current page for a specific browser instance.
    
    :param uid: The unique identifier for the browser instance
    :return: The screenshot as a PNG image or an error if the browser instance is not found
    """
    browser = browsers.get(uid)
    if not browser:
        raise HTTPException(status_code=404, detail="Browser instance not found")
    try:
        screenshot = browser.get_screenshot_as_png()
        return StreamingResponse(BytesIO(screenshot), media_type="image/png")
    except WebDriverException as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/v1/connectors/browser/human_source/{uid}")
async def get_human_readable_content(uid: str):
    """
    Get a human-readable version of the page content for a specific browser instance.
    
    :param uid: The unique identifier for the browser instance
    :return: The human-readable content or an error if the browser instance is not found
    """
    browser = browsers.get(uid)
    if not browser:
        raise HTTPException(status_code=404, detail="Browser instance not found")
    try:
        page_source = browser.page_source
        soup = BeautifulSoup(page_source, 'html.parser')
        for script in soup(['script', 'style', 'head']):
            script.extract()
        for comment in soup.find_all(text=lambda text: isinstance(text, Comment)):
            comment.extract()
        readable_content = str(soup)
        return {"source": readable_content}
    except WebDriverException as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8676)