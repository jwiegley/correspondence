#! /usr/bin/env nix-shell
#! nix-shell -i python3 -p python3Packages.pandas -p python3Packages.google-api-python-client -p python3Packages.google-auth-httplib2 -p python3Packages.google-auth-oauthlib

import os
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
import pandas as pd

# Configuration
SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/tasks'
]
SHEETS_CREDENTIALS_FILE = 'credentials.json'
GMAIL_LABELS_TO_INCLUDE = ['Label1', 'Label2']  # Replace with your labels
GMAIL_LABEL_NOT_FOR_LOG = 'Not For Log'

def authenticate_google_services():
    """Authenticate and return Gmail, Tasks, and Sheets services."""
    creds = None
    if os.path.exists('token.json'):
        creds = Credentials.from_authorized_user_file('token.json', SCOPES)
    if not creds or not creds.valid:
        from google_auth_oauthlib.flow import InstalledAppFlow
        flow = InstalledAppFlow.from_client_secrets_file(
            'credentials.json', SCOPES)
        creds = flow.run_local_server(port=0)
        with open('token.json', 'w') as token:
            token.write(creds.to_json())
    gmail_service = build('gmail', 'v1', credentials=creds)
    tasks_service = build('tasks', 'v1', credentials=creds)
    sheets_service = build('sheets', 'v4', credentials=creds)
    return gmail_service, tasks_service, sheets_service

def fetch_emails(gmail_service):
    """Fetch emails from specified folders/labels."""
    results = []
    for label in GMAIL_LABELS_TO_INCLUDE:
        query = f'label:{label} -label:{GMAIL_LABEL_NOT_FOR_LOG}'
        messages = gmail_service.users().messages().list(
            userId='me', q=query).execute().get('messages', [])
        if not messages:
            continue
        for msg in messages:
            message = gmail_service.users().messages().get(
                userId='me', id=msg['id']).execute()
            print(message)
            results.append({
                'Subject': message['payload']['headers'][0]['value'],
                'Date': message['payload']['headers'][1]['value'],
                'From': message['payload']['headers'][2]['value'],
                'Labels': message['labelIds'],
                'Attachments': len(message.get('payload', {}).get('parts', [])) > 0
            })
    return pd.DataFrame(results)

def linkify_subjects(df):
    """Add hyperlinks to Gmail messages."""
    df['Subject'] = df.apply(
        lambda row: f'=HYPERLINK("https://mail.google.com/mail/u/0/#inbox/{row.name}", "{row.Subject}")',
        axis=1)
    return df

def get_action_items(tasks_service, email_subjects):
    """Retrieve action items from Google Tasks."""
    tasklists = tasks_service.tasklists().list().execute()
    all_tasks = []
    for tl in tasklists.get('items', []):
        tasks = tasks_service.tasks().list(tasklist=tl['id']).execute()
        all_tasks.extend(tasks.get('items', []))
    return pd.DataFrame({
        'Subject': email_subjects,
        'Tasks': ['; '.join([t['title'] for t in all_tasks if email_subj in t['title']])
                 for email_subj in email_subjects]
    })

def format_correspondence_log(df):
    """Apply formatting rules to the log."""
    df = linkify_subjects(df)
    df['Checkbox (Attachments)'] = df['Attachments'].apply(lambda x: '☑️' if x else '')
    df['Non-Inbox/Pending Labels'] = df['Labels'].apply(
        lambda labels: '; '.join([l for l in labels
                                 if l not in ['Inbox', 'Pending']]))
    df['Background Color (Pending)'] = df.apply(
        lambda row: '#f0f0f0' if 'Pending' in row.Labels else '', axis=1)
    return df.drop('Labels', axis=1)

def export_to_sheets(sheets_service, df):
    """Export DataFrame to Google Sheets."""
    sheet_id = '1CgUjjXu59KcJmJ_gS6gXQJ5gN5dpi2S1w-27CXrsEzs'
    body = {'values': [df.columns.tolist()] + df.values.tolist()}
    sheets_service.spreadsheets().values().update(
        spreadsheetId=sheet_id,
        range='A1:Z999',
        valueInputOption='RAW',
        body=body).execute()

def main():
    gmail_service, tasks_service, sheets_service = authenticate_google_services()

    # Fetch emails and process
    df = fetch_emails(gmail_service)
    print(df)
    if not df.empty:
        df = format_correspondence_log(df)

        # Get action items
        email_subjects = df['Subject'].tolist()
        task_df = get_action_items(tasks_service, email_subjects)
        final_df = pd.merge(df, task_df, on='Subject')

        # Export to Sheets
        export_to_sheets(sheets_service, final_df)

    print("Correspondence log generated and exported successfully.")

if __name__ == '__main__':
    main()
