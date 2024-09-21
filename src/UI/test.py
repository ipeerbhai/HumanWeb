import streamlit as st

# Set the title of the app
st.title('Welcome to My Streamlit App!')

# Create a text input widget
user_input = st.text_input('Enter your name:')

# Check if the user has entered any text
if user_input:
    # Display the greeting message
    st.write(f'Hello, {user_input}!')
else:
    # Prompt the user to enter some text
    st.write('Please enter your name above to receive a greeting')