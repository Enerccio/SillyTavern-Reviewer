
import {EXTENSION_NAME, EXTENSION_PATH, MODULE_NAME, VERSION } from './conf.js';
import {
    check_objects_different, clean_string_for_html,
    error,
    escape_string, get_chat_metadata, get_current_character_identifier, global_references,
    log, set_chat_metadata, toast,
    unescape_string,
} from '/scripts/extensions/third-party/SillyTavern-Reviewer/utils.js';
import { extension_settings, getContext, renderExtensionTemplateAsync } from '/scripts/extensions.js';
import { saveSettingsDebounced } from '/script.js';
import { Popup, POPUP_TYPE } from '/scripts/popup.js';
import { get_connection_profiles } from '/scripts/extensions/third-party/SillyTavern-Reviewer/connections.js';
import { t } from '/scripts/i18n.js';
import { openGroupId, selected_group } from '/scripts/group-chats.js';

export const default_settings = {
    review_prompt: `\nReview:`,
    review_prompt_pre: `Text below is a fictional short story. Generate reviews of this story as if it was a reddit thread about it.
Include lot of details, both positive and negative reviews.`,
    remove_instruction: true,
    remove_user: false,
    remove_character: false,
    remove_world_info: false,
};
export const global_settings = {
    profiles: {},  // dict of profiles by name
    character_profiles: {},  // dict of character identifiers to profile names
    profile: 'Default', // Current profile
    notify_on_profile_switch: false,
    connection_profile: "",  // connection profile to use for summarization. Empty ("") indicates the same as currently selected.
};

export const settings_content_class = `reviewer_settings_content`;
const group_member_enable_button = `reviewer_group_member_enable`
const group_member_enable_button_highlight = `reviewer_group_member_enabled`

export function bind_function(selector, func, disable=true) {
    // bind a function to an element (typically a button or input)
    // if disable is true, disable the element if chat is disabled
    selector = `.${settings_content_class} ${selector}`
    // noinspection JSUnresolvedReference
    let element = $(selector);
    if (element.length === 0) {
        error(`No element found for selector [${selector}] when binding function`);
        return;
    }

    // mark as a settings UI element
    if (disable) {
        // noinspection JSUnresolvedReference
        element.addClass('settings_input');
    }

    // check if it's an input element, and bind a "change" event if so
    if (element.is('input')) {
        element.on('change', function (event) {
            func(event);
        });
    } else {  // otherwise, bind a "click" event
        element.on('click', function (event) {
            func(event);
        });
    }
}

const settings_ui_map = {}  // map of settings to UI elements

export function set_setting_ui_element(key, element, type) {
    // Set a UI element to the current setting value
    let radio = false;
    if (element.is('input[type="radio"]')) {
        radio = true;
    }

    // get the setting value
    let setting_value = get_settings(key);
    if (type === "text") {
        setting_value = escape_string(setting_value)  // escape values like "\n"
    }

    // initialize the UI element with the setting value
    if (radio) {  // if a radio group, select the one that matches the setting value
        let selected = element.filter(`[value="${setting_value}"]`)
        if (selected.length === 0) {
            error(`Error: No radio button found for value [${setting_value}] for setting [${key}]`);
            return;
        }
        selected.prop('checked', true);
    } else {  // otherwise, set the value directly
        if (type === 'boolean') {  // checkbox
            element.prop('checked', setting_value);
        } else {  // text input or dropdown
            // noinspection JSUnresolvedReference
            element.val(setting_value);
        }
    }
}

export function bind_setting(selector, key, type=null, callback=null, disable=true) {
    // Bind a UI element to a setting, so if the UI element changes, the setting is updated
    selector = `.${settings_content_class} ${selector}`  // add the settings div to the selector
    // noinspection JSUnresolvedReference
    let element = $(selector)
    settings_ui_map[key] = [element, type]

    // if no elements found, log error
    if (element.length === 0) {
        error(`No element found for selector [${selector}] for setting [${key}]`);
        return;
    }

    // mark as a settings UI function
    if (disable) {
        // noinspection JSUnresolvedReference
        element.addClass('settings_input');
    }

    // default trigger for a settings update is on a "change" event (as opposed to an input event)
    let trigger = 'change';

    // Set the UI element to the current setting value
    set_setting_ui_element(key, element, type);

    // Make the UI element update the setting when changed
    element.on(trigger, function (event) {
        let value;
        if (type === 'number') {  // number input
            // noinspection JSUnresolvedReference
            value = Number($(this).val());
        } else if (type === 'boolean') {  // checkbox
            // noinspection JSUnresolvedReference
            value = Boolean($(this).prop('checked'));
        } else {  // text, dropdown, select2
            // noinspection JSUnresolvedReference
            value = $(this).val();
            value = unescape_string(value)  // ensures values like "\n" are NOT escaped from input
        }

        // update the setting
        log(`Setting Triggered: [${key}] [${value}]`)
        set_settings(key, value)

        // trigger callback if provided, passing the new value
        if (callback !== null) {
            // noinspection JSValidateTypes
            callback(value);
        }

        // update all other settings UI elements
        refresh_settings();
    });
}

export function set_settings(key, value, copy=false) {
    // Set a setting for the extension and save it
    if (copy) {
        value = structuredClone(value)
    }
    extension_settings[MODULE_NAME][key] = value;
    saveSettingsDebounced();
}

export function get_settings(key, copy=false) {
    // Get a setting for the extension, or the default value if not set
    let value = extension_settings[MODULE_NAME]?.[key] ?? default_settings[key];
    if (copy) {  // needed when retrieving objects
        return structuredClone(value)
    } else {
        return value
    }
}

export function soft_reset_settings() {
    // fix any missing settings without destroying profiles
    extension_settings[MODULE_NAME] = Object.assign(
        structuredClone(default_settings),
        structuredClone(global_settings),
        extension_settings[MODULE_NAME]
    );

    // check for any missing profiles
    let profiles = get_settings('profiles');
    if (Object.keys(profiles).length === 0) {
        log("No profiles found, creating default profile.")
        profiles['Default'] = structuredClone(default_settings);
        set_settings('profiles', profiles);
    } else { // for each existing profile, add any missing default settings without overwriting existing settings
        for (let [profile, settings] of Object.entries(profiles)) {
            profiles[profile] = Object.assign(structuredClone(default_settings), settings);
        }
        set_settings('profiles', profiles);
    }
}

export function hard_reset_settings() {
    // Set the settings to the completely fresh values, deleting all profiles too
    if (global_settings['profiles']['Default'] === undefined) {  // if the default profile doesn't exist, create it
        global_settings['profiles']['Default'] = structuredClone(default_settings);
    }
    extension_settings[MODULE_NAME] = structuredClone({
        ...default_settings,
        ...global_settings
    });
}

export function copy_settings(profile=null) {
    // copy the setting from the given profile (or current settings if none provided)
    let settings;

    if (!profile) {  // no profile given, copy current settings
        settings = structuredClone(extension_settings[MODULE_NAME]);
    } else {  // copy from the profile
        let profiles = get_settings('profiles');
        if (profiles[profile] === undefined) {  // profile doesn't exist, return empty
            return {}
        }

        // copy the settings from the profile
        settings = structuredClone(profiles[profile]);
    }

    // remove global settings from the copied settings
    for (let key of Object.keys(global_settings)) {
        delete settings[key];
    }
    return settings;
}

export function update_profile_section() {
    let current_profile = get_settings('profile');
    let current_character_profile = get_character_profile();
    let current_chat_profile = get_chat_profile();
    let profile_options = Object.keys(get_settings('profiles'));

    // noinspection JSUnresolvedReference
    let $choose_profile_dropdown = $(`.${settings_content_class} #profile`).empty();
    // noinspection JSUnresolvedReference
    let $character = $(`.${settings_content_class} button#character_profile`);
    // noinspection JSUnresolvedReference
    let $chat = $(`.${settings_content_class} button#chat_profile`);
    let $character_icon = $character.find('i');
    let $chat_icon = $chat.find('i');


    // Set the profile dropdowns to reflect the available profiles and the currently chosen one.
    // The value is set later when all config settings are updated
    for (let profile of profile_options) {
        // if the current character/chat has a default profile, indicate as such
        let text = profile
        let html_safe_name = clean_string_for_html(profile)
        if (profile === current_character_profile) {
            text = `${profile} (${t`Character`})`
        } else if (profile === current_chat_profile) {
            text = `${profile} (${t`Chat`})`
        }
        $choose_profile_dropdown.append(`<option value="${html_safe_name}">${text}</option>`);
    }

    // button highlights and icons
    let lock_class = 'fa-lock';
    let unlock_class = 'fa-unlock';
    let highlight_class = 'button_highlight';

    if (current_character_profile === current_profile) {
        // noinspection JSUnresolvedReference
        $character.addClass(highlight_class);
        // noinspection JSUnresolvedReference
        $character_icon.removeClass(unlock_class);
        // noinspection JSUnresolvedReference
        $character_icon.addClass(lock_class);
    } else {
        // noinspection JSUnresolvedReference
        $character.removeClass(highlight_class);
        // noinspection JSUnresolvedReference
        $character_icon.removeClass(lock_class);
        // noinspection JSUnresolvedReference
        $character_icon.addClass(unlock_class);
    }

    if (current_chat_profile === current_profile) {
        // noinspection JSUnresolvedReference
        $chat.addClass(highlight_class);
        // noinspection JSUnresolvedReference
        $chat_icon.removeClass(unlock_class);
        // noinspection JSUnresolvedReference
        $chat_icon.addClass(lock_class);
    } else {
        // noinspection JSUnresolvedReference
        $chat.removeClass(highlight_class);
        // noinspection JSUnresolvedReference
        $chat_icon.removeClass(lock_class);
        // noinspection JSUnresolvedReference
        $chat_icon.addClass(unlock_class);
    }
}

export async function update_connection_profile_dropdown() {
    // set the connection profile dropdown
    let $connection_select = $(`.${settings_content_class} #connection_profile`);
    let connection_profiles = await get_connection_profiles()
    $connection_select.empty();
    $connection_select.append(`<option value="">${t`Same as Current`}</option>`)
    for (let profile of connection_profiles) {  // construct the dropdown options
        $connection_select.append(`<option value="${profile.id}">${profile.name}</option>`)
    }

    let profile_id = get_settings('connection_profile')
    if (!verify_connection_profile(profile_id)) {
        toast_debounced(`Selected summary connection profile ID is invalid: ${ID}`, "warning")
        profile_id = ""  // fall back to "same as current"
    }
    $connection_select.val(profile_id)

    // set a click event to refresh the dropdown
    $connection_select.off('click').on('click', () => update_connection_profile_dropdown());
}

export function refresh_settings() {
    // Refresh all settings UI elements according to the current settings
    log("Refreshing settings...")

    // connection profiles
    // noinspection JSValidateTypes
    if (global_references.check_connection_profiles_active()) {
        // noinspection JSValidateTypes
        global_references.update_connection_profile_dropdown().then(() => {});
    } else {
        // if connection profiles extension isn't active, hide the connection profile dropdown
        // noinspection JSUnresolvedReference
        $(`.${settings_content_class} #connection_profile`).parent().parent().hide()
        log("Connection profiles extension not active. Hiding connection profile dropdown.")
    }


    // update the save icon highlight
    update_save_icon_highlight();

    // update the profile section
    update_profile_section();

    // iterate through the settings map and set each element to the current setting value
    for (let [key, [element, type]] of Object.entries(settings_ui_map)) {
        set_setting_ui_element(key, element, type);
    }

    set_character_enabled_button_states();
}

export function character_enabled(character_key) {
    // check if the given character is enabled for summarization in the current chat
    let group_id = selected_group
    if (selected_group === null) return true;  // not in group chat, always enabled

    let disabled_characters_settings = get_settings('disabled_group_characters')
    let disabled_characters = disabled_characters_settings[group_id]
    if (!disabled_characters) return true;
    return !disabled_characters.includes(character_key)
}

export function set_character_enabled_button_states() {
    // for each character in the group chat, set the button state based on their enabled status
    // noinspection JSUnresolvedReference
    let $enable_buttons = $(`#rm_group_members`).find(`.${group_member_enable_button}`)

    // if we are creating a new group (openGroupId is undefined), then hide the buttons
    if (openGroupId === undefined) {
        $enable_buttons.hide()
        return
    }

    // set the state of each button
    for (let button of $enable_buttons) {
        // noinspection JSUnresolvedReference
        let member_block = $(button).closest('.group_member');
        let char_key = member_block.data('id')
        let enabled = character_enabled(char_key)
        if (enabled) {
            // noinspection JSUnresolvedReference
            $(button).addClass(group_member_enable_button_highlight)
        } else {
            // noinspection JSUnresolvedReference
            $(button).removeClass(group_member_enable_button_highlight)
        }
    }
}

export async function render_settings_menu() {
    const settingsHtml = await renderExtensionTemplateAsync(
        EXTENSION_PATH,
        'settings',
        { title: EXTENSION_NAME, version: VERSION }
    );
    // noinspection JSUnresolvedReference
    $('#extensions_settings2').append(settingsHtml);
}

export async function show_settings_prompt() {
    // noinspection JSUnresolvedReference
    const template = $(await renderExtensionTemplateAsync(EXTENSION_PATH, 'edit_prompt'));
    const prompt = template.find('#reviewer_edit_prompt_value');
    // noinspection JSUnresolvedReference
    prompt.val(get_settings("review_prompt"));
    const popup = new Popup(template, POPUP_TYPE.CONFIRM, '',
        { wide: true, large: true, okButton: 'Save prompt', cancelButton: 'Discard changes' });
    const result = await popup.show();

    if (!result) {
        return;
    }

    // noinspection JSUnresolvedReference
    const new_settings_value = prompt.val();
    set_settings("review_prompt", String(new_settings_value));
}

export async function show_settings_prompt_pre() {
    // noinspection JSUnresolvedReference
    const template = $(await renderExtensionTemplateAsync(EXTENSION_PATH, 'edit_prompt'));
    const prompt = template.find('#reviewer_edit_prompt_value');
    const title = template.find('#reviewer_edit_prompt_value_title');
    title.innerHTML = "Reviewer Pre Prompt Value";
    // noinspection JSUnresolvedReference
    prompt.val(get_settings("review_prompt_pre"));
    const popup = new Popup(template, POPUP_TYPE.CONFIRM, '',
        { wide: true, large: true, okButton: 'Save prompt', cancelButton: 'Discard changes' });
    const result = await popup.show();

    if (!result) {
        return;
    }

    // noinspection JSUnresolvedReference
    const new_settings_value = prompt.val();
    set_settings("review_prompt_pre", String(new_settings_value));
}


function update_save_icon_highlight() {
    // If the current settings are different than the current profile, highlight the save button
    if (detect_settings_difference()) {
        // noinspection JSUnresolvedReference
        $(`.${settings_content_class} #save_profile`).addClass('button_highlight');
    } else {
        // noinspection JSUnresolvedReference
        $(`.${settings_content_class} #save_profile`).removeClass('button_highlight');
    }
}

function detect_settings_difference(profile=null) {
    // check if the current settings differ from the given profile
    if (!profile) {  // if none provided, compare to the current profile
        profile = get_settings('profile')
    }
    let current_settings = copy_settings();
    let profile_settings = copy_settings(profile);
    return check_objects_different(current_settings, profile_settings)
}

export function save_profile(profile=null) {
    // Save the current settings to the given profile
    if (!profile) {  // if none provided, save to the current profile
        profile = get_settings('profile');
    }
    log("Saving Configuration Profile: "+profile);

    // save the current settings to the profile
    let profiles = get_settings('profiles');
    profiles[profile] = copy_settings();
    set_settings('profiles', profiles);

    // update the button highlight
    update_save_icon_highlight();
}

export function load_profile(profile=null) {
    // load a given settings profile
    let current_profile = get_settings('profile')
    if (!profile) {  // if none provided, reload the current profile
        profile = current_profile
    }

    let settings = copy_settings(profile);  // copy the settings from the profile
    if (!Object.keys(settings).length) {
        error("Profile not found: "+profile);
        return;
    }

    log("Loading Configuration Profile: "+profile);
    Object.assign(extension_settings[MODULE_NAME], settings);  // update the settings
    set_settings('profile', profile);  // set the current profile
    if (get_settings("notify_on_profile_switch") && current_profile !== profile) {
        toast(`Switched to profile "${profile}"`, 'info')
    }
    migrate_profile()
    refresh_settings();
}

function migrate_profile() {
    // perform any necessary settings migrations on the current profile, saving the profile afterward

    // If the connection profile is a name, replace it with an ID
    let id = get_settings('connection_profile')
    // noinspection JSValidateTypes
    let data = global_references.get_connection_profiles().find((p) => p.name === id);
    if (id && data) {
        set_settings('connection_profile', data.id)
        save_profile()
        log(`Connection profile name swapped with {data.id}.`)
    }
}

export async function rename_profile() {
    // Rename the current profile via user input
    let ctx = getContext();
    let old_name = get_settings('profile');
    let new_name = await ctx.Popup.show.input("Rename Configuration Profile", `Enter a new name:`, old_name);

    // if it's the same name or none provided, do nothing
    if (!new_name || old_name === new_name) {
        return;
    }

    let profiles = get_settings('profiles');

    // check if the new name already exists
    if (profiles[new_name]) {
        error(`Profile [${new_name}] already exists`);
        return;
    }

    // rename the profile
    profiles[new_name] = profiles[old_name];
    delete profiles[old_name];
    set_settings('profiles', profiles);
    set_settings('profile', new_name);  // set the current profile to the new name

    // if any characters are using the old profile, update it to the new name
    let character_profiles = get_settings('character_profiles');
    for (let [character_key, character_profile] of Object.entries(character_profiles)) {
        if (character_profile === old_name) {
            character_profiles[character_key] = new_name;
        }
    }

    log(`Renamed profile [${old_name}] to [${new_name}]`);
    refresh_settings()
}

export function new_profile() {
    // create a new profile
    let profiles = get_settings('profiles');
    let profile = 'New Profile';
    let i = 1;
    while (profiles[profile]) {
        profile = `New Profile ${i}`;
        i++;
    }
    save_profile(profile);
    load_profile(profile);
}

export async function delete_profile() {
    // Delete the current profile
    if (get_settings('profiles').length === 1) {
        error("Cannot delete your last profile");
        return;
    }
    let profile = get_settings('profile');
    let profiles = get_settings('profiles');

    let result = await getContext().Popup.show.confirm(`Permanently delete profile: "${profile}"`, "", {okButton: 'Delete', cancelButton: 'Cancel'});
    if (!result) {
        return
    }

    // delete the profile
    delete profiles[profile];
    set_settings('profiles', profiles);
    toast(`Deleted Configuration Profile: \"${profile}\"`, "success");

    // remove any references to this profile connected to characters
    let character_profiles = get_settings('character_profiles') ?? {}
    for (let [id, name] of Object.entries(character_profiles)) {
        if (name === profile) {
            delete character_profiles[id]
        }
    }
    set_settings('character_profiles', character_profiles)

    // remove any references to this profile connected to chats
    // TODO currently can't remove references from chats since that now is now stored in the chat metadata
    //  and there isn't currently a way to access other chats' metadata.

    auto_load_profile()
}

export function toggle_character_profile() {
    // Toggle whether the current profile is set to the default for the current character
    let key = get_current_character_identifier();  // uniquely identify the current character or group chat
    log("Character Key: "+key)
    if (!key) {  // no character selected
        return;
    }

    // current profile
    let profile = get_settings('profile');

    // if the character profile is already set to the current profile, unset it.
    // otherwise, set it to the current profile.
    set_character_profile(key, profile === get_character_profile() ? null : profile);
}

export function toggle_chat_profile() {
    // Toggle whether the current profile is set to the default for the current chat
    let profile = get_settings('profile');  // current profile

    // if the chat profile is already set to the current profile, unset it.
    // otherwise, set it to the current profile.
    set_chat_profile(profile === get_chat_profile() ? null : profile);
}

export function get_character_profile(key) {
    // Get the profile for a given character
    if (!key) {  // if none given, assume the current character
        key = get_current_character_identifier();
    }
    let character_profiles = get_settings('character_profiles');
    let profile = character_profiles[key];
    let profiles = get_settings('profiles');
    if (!profile || profiles[profile] === undefined) return;  // profile doesn't exist
    return profile
}

export function set_character_profile(key, profile=null) {
    // Set the profile for a given character (or unset it if no profile provided)
    let character_profiles = get_settings('character_profiles');

    if (profile) {
        character_profiles[key] = profile;
        log(`Set character [${key}] to use profile [${profile}]`);
    } else {
        delete character_profiles[key];
        log(`Unset character [${key}] default profile`);
    }

    set_settings('character_profiles', character_profiles);
    refresh_settings()
}

export function get_chat_profile() {
    // Get the profile for the current chat
    let profile = get_chat_metadata('profile');
    let profiles = get_settings('profiles');
    if (profiles[profile] === undefined) return;  // profile doesn't exist
    return profile
}

export function set_chat_profile(profile=null) {
    // Set the profile for a given chat (or unset it if no profile provided)
    if (profile) {
        set_chat_metadata('profile', profile)
        log(`Set chat to use profile [${profile}]`);
    } else {
        set_chat_metadata('profile', null)
        log(`Unset chat default profile`);
    }
    refresh_settings()
}

export function auto_load_profile() {
    // Load the settings profile for the current chat or character
    let profile = get_chat_profile() || get_character_profile();
    load_profile(profile || 'Default');
    refresh_settings()
}

export function toggle_character_enabled(character_key) {
    // Toggle whether the given character is enabled for summarization in the current chat
    let group_id = selected_group
    if (group_id === undefined) return true;  // not in group chat, always enabled

    let disabled_characters_settings = get_settings('disabled_group_characters')
    let disabled_characters = disabled_characters_settings[group_id] || []
    let disabled = disabled_characters.includes(character_key)

    if (disabled) {  // if currently disabled, enable by removing it from the disabled set
        disabled_characters.splice(disabled_characters.indexOf(character_key), 1);
    } else {  // if enabled, disable by adding it to the disabled set
        disabled_characters.push(character_key);
    }

    disabled_characters_settings[group_id] = disabled_characters
    set_settings('disabled_group_characters', disabled_characters_settings)
    log(`${disabled ? "Enabled" : "Disabled"} group character summarization (${character_key})`)
}

export function initialize_settings() {
    if (extension_settings[MODULE_NAME] !== undefined) {  // setting already initialized
        log("Settings already initialized.")
        soft_reset_settings();
    } else {  // no settings present, first time initializing
        log("Extension settings not found. Initializing...")
        hard_reset_settings();
    }

    // load default profile
    load_profile();
}
