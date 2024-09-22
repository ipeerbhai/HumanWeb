# HumanWeb
A tool for LLMs to use the web with humans

Humans allow for authentications, going through robot checks and the software powered by LLMs can help to automate mundane and repeatable tasks.

## DSL

The project uses a Domain Specific Language specific to the application to be able to generate commands to the UI. 
The UI then performs the tasks with the human in the loop. 

### Generating DSL
We can generate DSL for the bot and use in the UI. 

The bot uses Selenium to browse the web. The repository involves an extension that can help grab the XPath and element IDs for generating the DSL through human language. 

Further iterations will be towards an extensions based on the browser to allow for faster verifications. 

### DSL Command Structure
command_structure = {
        "NAVIGATE": ["URL"],
        "ASK_USER": ["Prompt"],
        "CLICK_XPATH": ["XPath"],
        "TYPE_XPATH": ["XPath", "Text"],
        "SAVE_TO_VARIABLE": ["Variable Name", "Value"],
        "READ_XPATH": ["XPath"],
        "FIND_AND_SAVE": ["URL", "Query", "Variable Name"],
        "KEYBOARD_CLICK": ["Keyboard Button"],
    }