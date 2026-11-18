
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "carnet": {
          Tables: {
            "analytics_daily": {
                  Row: {
                    "day": string,"link_id": string | null,"metric": string,"profile_id": string,"source": string | null,"value": number
                  }
                  ComputedFields: never
                  Insert: {
                    "day": string,"link_id"?: string | null,"metric": string,"profile_id": string,"source"?: string | null,"value": number
                  }
                  Update: {
                    "day"?: string,"link_id"?: string | null,"metric"?: string,"profile_id"?: string,"source"?: string | null,"value"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "analytics_daily_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"analytics_events": {
                  Row: {
                    "device_class": string,"id": string,"link_id": string | null,"occurred_at": string,"profile_id": string,"source": string,"type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "device_class": string,"id": string,"link_id"?: string | null,"occurred_at"?: string,"profile_id": string,"source": string,"type": string
                  }
                  Update: {
                    "device_class"?: string,"id"?: string,"link_id"?: string | null,"occurred_at"?: string,"profile_id"?: string,"source"?: string,"type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "analytics_events_link_id_fkey"
      columns: ["link_id"]
isOneToOne: false
      referencedRelation: "links"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "analytics_events_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"leads": {
                  Row: {
                    "consent_at": string,"created_at": string,"email": string,"id": string,"idempotency_key": string,"message": string,"name": string,"profile_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "consent_at": string,"created_at"?: string,"email": string,"id"?: string,"idempotency_key": string,"message": string,"name": string,"profile_id": string
                  }
                  Update: {
                    "consent_at"?: string,"created_at"?: string,"email"?: string,"id"?: string,"idempotency_key"?: string,"message"?: string,"name"?: string,"profile_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "leads_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"links": {
                  Row: {
                    "created_at": string,"id": string,"label": string | null,"platform": string,"position": number,"profile_id": string,"updated_at": string,"url": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"label"?: string | null,"platform": string,"position": number,"profile_id": string,"updated_at"?: string,"url": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"label"?: string | null,"platform"?: string,"position"?: number,"profile_id"?: string,"updated_at"?: string,"url"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "links_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"nfc_tags": {
                  Row: {
                    "activated_at": string | null,"activation_code_hash": string,"batch_id": string,"created_at": string,"id": string,"profile_id": string | null,"status": string,"uid": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "activated_at"?: string | null,"activation_code_hash": string,"batch_id": string,"created_at"?: string,"id"?: string,"profile_id"?: string | null,"status"?: string,"uid": string,"updated_at"?: string
                  }
                  Update: {
                    "activated_at"?: string | null,"activation_code_hash"?: string,"batch_id"?: string,"created_at"?: string,"id"?: string,"profile_id"?: string | null,"status"?: string,"uid"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "nfc_tags_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"outbox": {
                  Row: {
                    "attempts": number,"created_at": string,"id": string,"last_error": string | null,"locked_at": string | null,"payload": NonNullable<Json>,"processed_at": string | null,"profile_id": string,"status": string,"type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"created_at"?: string,"id"?: string,"last_error"?: string | null,"locked_at"?: string | null,"payload": NonNullable<Json>,"processed_at"?: string | null,"profile_id": string,"status"?: string,"type": string
                  }
                  Update: {
                    "attempts"?: number,"created_at"?: string,"id"?: string,"last_error"?: string | null,"locked_at"?: string | null,"payload"?: NonNullable<Json>,"processed_at"?: string | null,"profile_id"?: string,"status"?: string,"type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "outbox_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "accepts_leads": boolean,"avatar_url": string | null,"banner_url": string | null,"bio": string | null,"company": string | null,"contact_email": string | null,"created_at": string,"display_name": string,"id": string,"is_indexable": boolean,"is_published": boolean,"job_title": string | null,"logo_url": string | null,"owner_id": string,"phone": string | null,"slug": string,"theme": NonNullable<Json>,"updated_at": string,"website_url": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "accepts_leads"?: boolean,"avatar_url"?: string | null,"banner_url"?: string | null,"bio"?: string | null,"company"?: string | null,"contact_email"?: string | null,"created_at"?: string,"display_name": string,"id"?: string,"is_indexable"?: boolean,"is_published"?: boolean,"job_title"?: string | null,"logo_url"?: string | null,"owner_id": string,"phone"?: string | null,"slug": string,"theme"?: NonNullable<Json>,"updated_at"?: string,"website_url"?: string | null
                  }
                  Update: {
                    "accepts_leads"?: boolean,"avatar_url"?: string | null,"banner_url"?: string | null,"bio"?: string | null,"company"?: string | null,"contact_email"?: string | null,"created_at"?: string,"display_name"?: string,"id"?: string,"is_indexable"?: boolean,"is_published"?: boolean,"job_title"?: string | null,"logo_url"?: string | null,"owner_id"?: string,"phone"?: string | null,"slug"?: string,"theme"?: NonNullable<Json>,"updated_at"?: string,"website_url"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"qr_codes": {
                  Row: {
                    "code": string,"created_at": string,"id": string,"profile_id": string,"style": NonNullable<Json>,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"created_at"?: string,"id"?: string,"profile_id": string,"style"?: NonNullable<Json>,"updated_at"?: string
                  }
                  Update: {
                    "code"?: string,"created_at"?: string,"id"?: string,"profile_id"?: string,"style"?: NonNullable<Json>,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "qr_codes_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: true
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"rate_limits": {
                  Row: {
                    "count": number,"key": string,"window_start": string
                  }
                  ComputedFields: never
                  Insert: {
                    "count": number,"key": string,"window_start": string
                  }
                  Update: {
                    "count"?: number,"key"?: string,"window_start"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            "public_profiles": {
                  Row: {
                    "accepts_leads": boolean | null,"avatar_url": string | null,"banner_url": string | null,"bio": string | null,"company": string | null,"contact_email": string | null,"display_name": string | null,"is_indexable": boolean | null,"job_title": string | null,"logo_url": string | null,"phone": string | null,"slug": string | null,"theme": Json | null,"website_url": string | null
                  }
                  ComputedFields: never
                  Insert: {
                           "accepts_leads"?: boolean | null,"avatar_url"?: string | null,"banner_url"?: string | null,"bio"?: string | null,"company"?: string | null,"contact_email"?: string | null,"display_name"?: string | null,"is_indexable"?: boolean | null,"job_title"?: string | null,"logo_url"?: string | null,"phone"?: string | null,"slug"?: string | null,"theme"?: Json | null,"website_url"?: string | null
                         }
                        Update: {
                           "accepts_leads"?: boolean | null,"avatar_url"?: string | null,"banner_url"?: string | null,"bio"?: string | null,"company"?: string | null,"contact_email"?: string | null,"display_name"?: string | null,"is_indexable"?: boolean | null,"job_title"?: string | null,"logo_url"?: string | null,"phone"?: string | null,"slug"?: string | null,"theme"?: Json | null,"website_url"?: string | null
                         }
                        Relationships: [
                    
                  ]
                }
          }
          Functions: {
            "activate_nfc_tag":
{ Args: { "p_code": string,"p_uid": string }; Returns: string
                           },
"aggregate_analytics_day":
{ Args: { "p_day": string }; Returns: undefined
                           },
"assert_valid_analytics_event":
{ Args: { "p_device_class": string,"p_id": string,"p_link_id": string,"p_source": string,"p_type": string }; Returns: undefined
                           },
"can_create_profile":
{ Args: { "p_owner_id": string }; Returns: boolean
                           },
"can_edit_profile":
{ Args: { "p_profile_id": string }; Returns: boolean
                           },
"can_read_profile_private":
{ Args: { "p_profile_id": string }; Returns: boolean
                           },
"capture_lead":
{ Args: { "p_device_class": string,"p_email": string,"p_idempotency_key": string,"p_message": string,"p_name": string,"p_slug": string }; Returns: string
                           },
"claim_outbox":
{ Args: { "p_limit": number }; Returns: {
              "attempts": number,"id": string,"lead_created_at": string,"lead_email": string,"lead_message": string,"lead_name": string,"owner_display_name": string,"owner_email": string,"type": string
            }[]
                           },
"complete_outbox":
{ Args: { "p_id": string }; Returns: undefined
                           },
"consume_rate_limit":
{ Args: { "p_key": string,"p_limit": number,"p_window": string }; Returns: boolean
                           },
"count_profile_media":
{ Args: { "p_profile_id": string }; Returns: number
                           },
"delete_own_account":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"ensure_qr_code":
{ Args: Record<PropertyKey, never>; Returns: {
              "code": string,
"created_at": string,
"id": string,
"profile_id": string,
"style": NonNullable<Json>,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "qr_codes"
        isOneToOne: true
        isSetofReturn: false
      } },
"fail_outbox":
{ Args: { "p_error": string,"p_id": string }; Returns: undefined
                           },
"get_own_daily_aggregates":
{ Args: { "p_from": string,"p_profile_id": string,"p_to": string }; Returns: Json
                           },
"get_public_links":
{ Args: { "p_slug": string }; Returns: {
              "id": string,"label": string,"platform": string,"position": number,"url": string
            }[]
                           },
"get_public_profile":
{ Args: { "p_slug": string }; Returns: {
              "accepts_leads": boolean | null,
"avatar_url": string | null,
"banner_url": string | null,
"bio": string | null,
"company": string | null,
"contact_email": string | null,
"display_name": string | null,
"is_indexable": boolean | null,
"job_title": string | null,
"logo_url": string | null,
"phone": string | null,
"slug": string | null,
"theme": Json | null,
"website_url": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "public_profiles"
        isOneToOne: true
        isSetofReturn: true
      } },
"is_member":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_orphan_account":
{ Args: { "p_user_id": string }; Returns: boolean
                           },
"is_valid_analytics_device_class":
{ Args: { "p_value": string }; Returns: boolean
                           },
"is_valid_analytics_metric":
{ Args: { "p_value": string }; Returns: boolean
                           },
"is_valid_analytics_source":
{ Args: { "p_value": string }; Returns: boolean
                           },
"is_valid_media_name":
{ Args: { "p_name": string }; Returns: boolean
                           },
"is_valid_plain_text":
{ Args: { "p_allow_newlines": boolean,"p_value": string }; Returns: boolean
                           },
"is_valid_qr_style":
{ Args: { "p_style": Json }; Returns: boolean
                           },
"list_orphan_media":
{ Args: { "p_older_than": string }; Returns: {
              "name": string
            }[]
                           },
"media_profile_id":
{ Args: { "p_object_name": string }; Returns: string
                           },
"provision_nfc_tags":
{ Args: { "p_batch_id": string,"p_count": number }; Returns: {
              "activation_code": string,"uid": string
            }[]
                           },
"purge_analytics_events":
{ Args: { "p_older_than": string }; Returns: number
                           },
"purge_leads":
{ Args: { "p_older_than": string }; Returns: number
                           },
"purge_outbox":
{ Args: { "p_older_than": string }; Returns: number
                           },
"purge_rate_limits":
{ Args: { "p_older_than": string }; Returns: number
                           },
"random_crockford":
{ Args: { "p_length": number }; Returns: string
                           },
"record_event":
{ Args: { "p_device_class": string,"p_id": string,"p_link_id": string,"p_profile_id": string,"p_source": string,"p_type": string }; Returns: undefined
                           },
"record_public_event":
{ Args: { "p_device_class": string,"p_id": string,"p_link_id": string,"p_slug": string,"p_source": string,"p_type": string }; Returns: undefined
                           },
"register_member":
{ Args: { "p_display_name": string,"p_slug": string,"p_user_id": string }; Returns: string
                           },
"release_nfc_tag":
{ Args: { "p_tag_id": string }; Returns: boolean
                           },
"replace_links":
{ Args: { "p_links": Json,"p_profile_id": string }; Returns: {
              "created_at": string,
"id": string,
"label": string | null,
"platform": string,
"position": number,
"profile_id": string,
"updated_at": string,
"url": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "links"
        isOneToOne: false
        isSetofReturn: true
      } },
"resolve_nfc_tag":
{ Args: { "p_uid": string }; Returns: {
              "slug": string,"state": string
            }[]
                           },
"resolve_qr_code":
{ Args: { "p_code": string }; Returns: string
                           },
"set_nfc_tag_enabled":
{ Args: { "p_enabled": boolean,"p_tag_id": string }; Returns: boolean
                           },
"set_profile_image":
{ Args: { "p_kind": string,"p_object_name": string }; Returns: string
                           },
"set_qr_style":
{ Args: { "p_style": Json }; Returns: {
              "code": string,
"created_at": string,
"id": string,
"profile_id": string,
"style": NonNullable<Json>,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "qr_codes"
        isOneToOne: true
        isSetofReturn: false
      } }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "carnet": {
          Enums: {
            
          }
        }
} as const
