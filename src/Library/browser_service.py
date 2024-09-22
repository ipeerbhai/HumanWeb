from typing import Dict, List
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from io import BytesIO
from pydantic import BaseModel
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.common.exceptions import WebDriverException
from bs4 import BeautifulSoup, Comment

app = FastAPI()

# Initialize Firefox browser and set it to fullscreen
firefox_options = webdriver.FirefoxOptions()
firefox_options.add_argument("--start-fullscreen")
browsers = {} # a dictionary holding uid -> selenium.driver instances
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
    element_name: str | None = None

@app.get("/")
def read_root():
    return {"Hello": "World"}

@app.post("/v1/connectors/browser/update_selected_element/")
async def update_selected_element(element: SelectedElement):
    global selected_elements
    selected_elements.append({"name": element.element_name, "html": element.element_html})
    return {"status": "success"}

@app.get("/v1/connectors/browser/get_last_selected_element/")
async def get_last_selected_element():
    if selected_elements:
        return {"element": selected_elements[-1]}
    else:
        raise HTTPException(status_code=404, detail="No element has been selected yet")

@app.get("/v1/connectors/browser/get_all_selected_elements/")
async def get_all_selected_elements():
    if selected_elements:
        return {"elements": selected_elements}
    else:
        raise HTTPException(status_code=404, detail="No elements have been selected yet")

@app.get("/v1/connectors/browser/get_element_by_name/{element_name}")
async def get_element_by_name(element_name: str):
    for element in selected_elements:
        if element["name"] == element_name:
            return {"element": element}
    raise HTTPException(status_code=404, detail=f"No element found with name: {element_name}")

@app.get("/v1/connectors/browser/clear_selected_elements/")
async def clear_selected_elements():
    global selected_elements
    selected_elements = []
    return {"status": "success"}
	
@app.post("/v1/connectors/browser/navigate/")
async def navigate(details: NavigateDetails):
    browser=None
    ## see if browsers contains the uid
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
            # Handle invalid session by creating a new browser instance.
            browser = webdriver.Firefox(options=firefox_options)
            browser.get(details.url)
            source = browser.page_source
            return {"source": source}
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/v1/connectors/browser/source/{uid}")
async def get_page_source(uid:str):
    browser = None
    if uid in browsers:
        browser = browsers[uid]
    try:
        source = browser.page_source
        return {"source": source}
    except WebDriverException as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/v1/connectors/browser/screenshot/{uid}")
async def get_screenshot(uid:str):
    browser = None
    if uid in browsers:
        browser = browsers[uid]
    try:
        # Take the screenshot and store it in memory
        screenshot = browser.get_screenshot_as_png()
        return StreamingResponse(BytesIO(screenshot), media_type="image/png")
    except WebDriverException as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/v1/connectors/browser/FindDo/")
async def find_and_do_action(element_details: ElementActions):
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

            
        # Extend for other "By" methods like name, xpath, etc.

        if element_details.Action == "click":
            field.click()
        elif element_details.Action == "fill":
            for line in element_details.Text:
                field.send_keys(line)
    except WebDriverException as e:
        raise HTTPException(status_code=500, detail=str(e))
    
@app.get("/v1/connectors/browser/human_source/{uid}")
async def get_human_readable_content(uid:str):
    browser = None
    if uid in browsers:
        browser = browsers[uid]
    try:

        # Fetch page source
        page_source = browser.page_source

        # Parse with BeautifulSoup
        soup = BeautifulSoup(page_source, 'html.parser')

        # Remove scripts and styles, which are not visible
        for script in soup(['script', 'style', 'head']):
            script.extract()

        # Also remove comments
        for comment in soup.find_all(text=lambda text: isinstance(text, Comment)):
            comment.extract()
        
        readable_content= str(soup)
        return {"source": readable_content}
    except WebDriverException as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8676)
