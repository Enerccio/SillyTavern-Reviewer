# SillyTavern-Reviewer

SillyTavern-Reviewer is an extension for SillyTavern that allows you to generate AI-powered reviews or critiques for specific messages in your chat. Whether you want to simulate a Reddit thread discussing your story's progress or get a critical analysis of a character's response, this extension provides a dedicated workspace to generate, store, and edit these reviews.

## 🚀 Features

- **Per-Message Reviews**: Generate unique reviews for any message in your chat history.
- **Configuration Profiles**: Create and switch between different reviewer personas (e.g., "Harsh Critic", "Reddit Simulator", "Editor").
- **Context Awareness**: The extension automatically handles the prompt construction, including chat history and current message context.
- **Flexible Prompting**: Customize both the "Pre-prompt" (system/instructional) and "Post-prompt" (the specific request) for your reviews.
- **Swipe Support**: Reviews are linked to specific message swipes, ensuring your critique matches the version of the message you are viewing.
- **Smart Trimming**: Options to exclude instructions, user personas, character descriptions, or world info from the review prompt to save tokens.
- **Reasoning Support**: If your AI model supports reasoning/thought chains, the extension can display the "Thinking" process behind the review.

## 📦 Installation

1. Navigate to your SillyTavern installation folder.
2. Go to `public/scripts/extensions/third-party/`.
3. Clone or move the `SillyTavern-Reviewer` folder into this directory.
4. Restart SillyTavern or refresh your browser.

Alternatively install as any other SillyTavern extension by using the Install Extension button in the Extensions menu.

## ⚙️ Options & Configuration

You can find the settings in the **Extensions** menu under **SillyTavern-Reviewer**.

### Configuration Profiles
- **Profile Management**: Create, rename, save, or delete profiles. This allows you to have different "Reviewer" settings for different characters or types of stories.
- **Auto-load**:
    - **Character**: Lock a specific reviewer profile to a character.
    - **Chat**: Lock a specific reviewer profile to a specific chat session.
- **Notify on Switch**: Receive a toast notification when the profile changes automatically.

### Review Prompts
- **Edit Pre**: Set the system-level instructions for the reviewer.
- **Edit Post**: Set the primary request (e.g., "Critique the pacing of this scene").

### Request Settings
- **Connection Profile**: Choose which API connection to use for reviews. You can set this to a specific profile or "Same as Current" to use your active chat settings.
- **Prompt Filtering**:
    - **Do not include instructions**: Removes the main AI instructions from the review context.
    - **Do not include persona**: Removes the user persona.
    - **Do not include character**: Removes the character description.
    - **Do not include world info**: Removes Lorebook/World Info entries.

## 🛠 Usage

### Generating a Review
1. Hover over a message in the chat.
2. Click the **Star icon** ($\text{fa-star}$) in the message buttons to open the Review window.
3. The extension will automatically generate a review based on your active profile.
4. Use the **Right Arrow** to generate a new version of the review.
5. Use the **Left Arrow** to navigate back through previous versions.

### Managing Reviews
- **Editing**: Click directly on the generated review text in the popup to enter edit mode. Click outside or press Enter to save your changes.
- **Continuing**: If the review was cut off, click the **Continue generating** button (only works with Text Completion mode).
- **Deletion**: Click the **Half-Star icon** ($\text{fa-star-half}$) on the message to permanently delete the reviews associated with that message.
- **Visual Indicator**: Messages that already have a generated review will display a "Has review" label within the message bubble. You can click on this label to open the Review window.

## 📜 License
This project is licensed under the **GNU Affero General Public License v3.0**.
