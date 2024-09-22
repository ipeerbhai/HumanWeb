# HumanWeb
A tool for LLMs to use the web with humans

Humans allow for authentications, going through robot checks and the software powered by LLMs can help to automate mundane and repeatable tasks.

## DSL

The project uses a Domain Specific Language specific to the application to be able to generate commands to the UI. 
The UI then performs the tasks with the human in the loop. 

### Generating DSL
Using the following chat: https://chatgpt.com/share/66f0761f-5834-8003-93e5-5e41d4307ebe
We can generate DSL for the bot and use in the UI. 

The bot uses Selenium to browse the web. The repository involves an extension that can help grab the XPath and element IDs for generating the DSL through human language. 

Further iterations will be towards an extensions based on the browser to allow for faster verifications. 