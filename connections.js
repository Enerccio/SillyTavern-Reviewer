import {
    error,
    global_references,
    log,
    toast_debounced,
} from '/scripts/extensions/third-party/SillyTavern-Reviewer/utils.js';
import { CONNECT_API_MAP } from '/scripts/slash-commands.js';
import { t } from '/scripts/i18n.js';
import {
    get_settings,
    settings_content_class,
} from '/scripts/extensions/third-party/SillyTavern-Reviewer/settings.js';
import { amount_gen, getMaxContextSize } from '/script.js';

const context = SillyTavern.getContext();

export function check_connection_profiles_active() {
    // detect whether the connection profiles extension is active
    return !context.extensionSettings.disabledExtensions.includes('connection-manager')
}
global_references.check_connection_profiles_active = check_connection_profiles_active;

export function get_connection_profiles() {
    // Get a list of available connection profiles
    if (!check_connection_profiles_active()) return [];  // if the extension isn't active, return
    return context.extensionSettings.connectionManager.profiles
}

export function verify_connection_profile(id) {
    // check if the given connection profile ID is valid.
    if (!check_connection_profiles_active()) return;  // if the extension isn't active, return
    if (id === "") return true;  // no profile selected, always valid
    let data = get_connection_profile_data(id)  // found an existing profile for this ID
    return !!data;
}

export function get_connection_profile_data(id) {
    // Return the info for the given connection profile ID
    let data = get_connection_profiles().find((p) => p.id === id);
    if (data) return data
    error(`Connection profile not found for ID: ${id}`)
}
global_references.get_connection_profiles = get_connection_profiles;

export function get_connection_profile_api(id) {
    // Get the API for the given connection profile ID. If not given, get the current summary profile.
    if (!check_connection_profiles_active()) return;  // if the extension isn't active, return
    if (id === undefined) id = get_connection_profile()
    let data = get_connection_profile_data(id)

    // If the API type isn't defined, it might be excluded from the connection profile. Assume based on mode.
    if (data.api === undefined) {
        log(`API not defined in connection profile ${name}. Mode is ${data.mode}`)
        if (data.mode === 'tc') return 'textgenerationwebui'
        if (data.mode === 'cc') return 'openai'
    }

    // need to map the API type to a completion API
    if (CONNECT_API_MAP[data.api] === undefined) {
        error(`API type "${data.api}" not found in CONNECT_API_MAP - could not identify API.`)
        return
    }
    return CONNECT_API_MAP[data.api].selected
}

export function get_connection_profile() {
    // get the summary connection profile ID OR the default if it isn't valid for the current API
    let id = get_settings('connection_profile');

    // If none selected, invalid, or connection profiles not active, use the current profile
    if (id === "" || !verify_connection_profile(id) || !check_connection_profiles_active()) {
        id = get_current_connection_profile();
    }

    return id
}

export function get_current_connection_profile() {
    // Return the ID of the currently selected connection profile for chatting
    if (!check_connection_profiles_active()) return;  // if the extension isn't active, return
    return context.extensionSettings.connectionManager.selectedProfile;
}

function get_summary_connection_profile() {
    // get the summary connection profile ID OR the default if it isn't valid for the current API
    let id = get_settings('connection_profile');

    // If none selected, invalid, or connection profiles not active, use the current profile
    if (id === "" || !verify_connection_profile(id) || !check_connection_profiles_active()) {
        id = get_current_connection_profile();
    }

    return id
}

export function get_max_tokens(preset) {
    // Get the maximum token length for the chosen profile's completion preset
    // if the preset doesn't have a genamt use the current genamt.
    // it might be null if the preset has never been saved or was reset to default.
    // Also if you are using chat completion, it's openai_max_tokens instead.
    if (preset === undefined) preset = get_completion_preset()
    let max_tokens = preset?.genamt || preset?.openai_max_tokens || amount_gen
    log("Got summary preset response token limit: ", max_tokens)
    return max_tokens
}

export function get_context_size() {
    // Get the context size for the current summary profile
    let preset = get_completion_preset()
    let max_context = preset?.max_length || preset?.openai_max_context
    let max_response = get_summary_max_tokens(preset)
    let context = max_context - max_response
    log("Got summary preset effective context size: ", context)
    return context
}

export function get_completion_preset() {
    // Return the completion preset for the current summary profile
    let presetManager = context.getPresetManager()

    // First get the preset name for the current summary connection profile
    let id = get_summary_connection_profile()
    let profile = get_connection_profile_data(id)
    let preset;
    if (profile.preset) {
        log("Summary connection profile has a preset: ", profile.preset)
        let name = profile.preset
        let api = get_connection_profile_api(id)
        let { presets, preset_names } = presetManager.getPresetList(api);
        // Some APIs use an array of names, others use an object of {name: index}

        if (Array.isArray(preset_names)) {  // array of names
            if (preset_names.includes(name)) {
                preset = presets[preset_names.indexOf(name)];
            }
        } else {  // object of {names: index}
            if (preset_names[name] !== undefined) {
                preset = presets[preset_names[name]];
            }
        }
    } else {  // A preset is not given for this connection profile, so use the currently selected one as a backup.
        log("No preset found for summary connection profile. Using current as backup.")
        preset = presetManager.getPresetSettings(presetManager.getSelectedPresetName())
    }

    if (preset === undefined) {
        console.error(`Preset ${preset} not found`);
    }

    return preset
}

export async function update_connection_profile_dropdown() {
    // set the connection profile dropdown
    // noinspection JSUnresolvedReference
    let $connection_select = $(`.${settings_content_class} #connection_profile`);
    let connection_profiles = await get_connection_profiles()
    $connection_select.empty();
    // noinspection JSUnresolvedReference
    $connection_select.append(`<option value="">${t`Same as Current`}</option>`)
    for (let profile of connection_profiles) {  // construct the dropdown options
        $connection_select.append(`<option value="${profile.id}">${profile.name}</option>`)
    }

    let profile_id = get_settings('connection_profile')
    if (!verify_connection_profile(profile_id)) {
        toast_debounced(`Selected summary connection profile ID is invalid: ${profile_id}`, "warning")
        profile_id = ""  // fall back to "same as current"
    }
    // noinspection JSUnresolvedReference
    $connection_select.val(profile_id)

    // set a click event to refresh the dropdown
    $connection_select.off('click').on('click', () => update_connection_profile_dropdown());
}
global_references.update_connection_profile_dropdown = update_connection_profile_dropdown;
